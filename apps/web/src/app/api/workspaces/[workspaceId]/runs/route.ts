import {
  buildRunConfigRequestCandidate,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { createPostgresRepository, planAgentDispatch } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveRunCommandIdentities } from "@/lib/run-command-identity";
import {
  getAgentDispatchAuthority,
  getAgentProfileRegistry,
  getEffectiveConfigResolver,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";
import { workspaceRunProjection } from "@/lib/workspace-run";

const createRunSchema = z.strictObject({
  question: z.string().trim().min(1).max(4_000),
  idempotencyKey: workspaceIdempotencyKeySchema,
  datasourceId: z.uuid(),
  datasourceRevision: z.number().int().positive().safe(),
  conversationId: z.uuid(),
});

const inherited = { mode: "INHERIT_DEFAULT" } as const;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = createRunSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "RUN_INPUT_INVALID",
      message: "Run 问题、幂等键或资源 ID 不符合严格契约。",
      retryable: false,
    });
  }

  const conversation = await getWorkspaceDataRepository().getConversation(
    authorized.value.capability,
    input.data.conversationId,
  );
  if (!conversation.ok) return workspaceErrorResponse(conversation.error);
  if (!conversation.value) {
    return workspaceErrorResponse({
      code: "CONVERSATION_NOT_FOUND_OR_DENIED",
      message: "对话不存在或无权访问。",
      retryable: false,
    });
  }
  const conversationVersion = z
    .number()
    .int()
    .positive()
    .safe()
    .safeParse(conversation.value.resource_version);
  if (!conversationVersion.success) {
    return workspaceErrorResponse({
      code: "CONVERSATION_VERSION_REQUIRED",
      message: "对话缺少可冻结的资源版本。",
      retryable: true,
    });
  }

  const resolver = getEffectiveConfigResolver();
  const [defaults, profiles] = await Promise.all([
    resolver.getWorkspaceDefaults(authorized.value.capability),
    getAgentProfileRegistry().list(authorized.value.capability, true),
  ]);
  if (!defaults.ok) return workspaceErrorResponse(defaults.error);
  if (!profiles.ok) return workspaceErrorResponse(profiles.error);
  if (!defaults.value) {
    return workspaceErrorResponse({
      code: "WORKSPACE_DEFAULTS_NOT_CONFIGURED",
      message: "工作空间尚未配置 Run Defaults。",
      retryable: false,
    });
  }

  const identities = deriveRunCommandIdentities({
    workspace_id: workspaceId,
    principal_id: authorized.value.capability.principal,
    idempotency_key: input.data.idempotencyKey,
  });
  const runId = identities.run_id;
  const rollout = await getAgentDispatchAuthority().resolveRolloutPolicy(
    authorized.value.capability,
    process.env.DATA_AGENT_DISPATCH_BOOTSTRAP_MODE,
  );
  if (!rollout.ok) return workspaceErrorResponse(rollout.error);
  const dispatch = await planAgentDispatch({
    run_id: runId,
    question: input.data.question,
    enabled_profiles: profiles.value,
    rollout_mode: rollout.value.mode,
    policy_version: rollout.value.policy_version,
  });
  if (dispatch.admission.kind === "DEFERRED") {
    const deferred = await getAgentDispatchAuthority().commitDeferred(authorized.value.capability, {
      idempotency_key: input.data.idempotencyKey,
      question: input.data.question,
      receipt: dispatch.admission,
    });
    if (!deferred.ok) return workspaceErrorResponse(deferred.error);
    return NextResponse.json({ dispatch: deferred.value }, { status: 409 });
  }
  const configRequest = await buildRunConfigRequestCandidate({
    schema_version: "run-config-request@1.0.0",
    operation: "QUESTION_RUN",
    workspace_id: workspaceId,
    run_id: runId,
    idempotency_key: input.data.idempotencyKey,
    conversation_ref: {
      conversation_id: conversation.value.conversation_id,
      expected_resource_version: conversationVersion.data,
    },
    defaults_ref: defaults.value.defaults_ref,
    overrides: {
      model: inherited,
      datasource: {
        mode: "RESOURCE_IDS",
        resources: [
          {
            resource_id: input.data.datasourceId,
            expected_revision: input.data.datasourceRevision,
          },
        ],
      },
      files: inherited,
      knowledge: inherited,
      mcp_servers: inherited,
      skills: inherited,
      egress: null,
    },
    mentions: [],
  });
  if (configRequest.operation !== "QUESTION_RUN") {
    throw new TypeError("QUESTION_RUN_CONFIG_BUILD_FAILED");
  }
  const accepted = await resolver.resolveAndAccept(authorized.value.capability, {
    request: configRequest,
    command: {
      run_id: runId,
      command_id: identities.command_id,
      event_id: identities.event_id,
      outbox_id: identities.outbox_id,
      audit_id: identities.audit_id,
      idempotency_key: input.data.idempotencyKey,
      question: input.data.question,
      dispatch_admission: dispatch.admission,
      shadow_dispatch_plan: dispatch.shadow_plan,
    },
  });
  if (!accepted.ok) return workspaceErrorResponse(accepted.error);
  if (accepted.value.operation !== "QUESTION_RUN" || accepted.value.admission !== "READY") {
    return NextResponse.json({ resolution: accepted.value }, { status: 409 });
  }

  const repository = createPostgresRepository(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
  );
  const [persisted, effectiveConfig] = await Promise.all([
    repository.getRun(authorized.value.capability, { run_id: runId }),
    resolver.getEffectiveConfig(authorized.value.capability, {
      run_id: runId,
      config_ref: accepted.value.effective_config_ref,
      conversation_ref: configRequest.conversation_ref,
    }),
  ]);
  if (!persisted.ok) return workspaceErrorResponse(persisted.error);
  if (!effectiveConfig.ok) return workspaceErrorResponse(effectiveConfig.error);
  if (!persisted.value) {
    return workspaceErrorResponse({
      code: "PERSISTENCE_TRANSACTION_FAILED",
      message: "Run 已接受但当前无法读取权威投影。",
      retryable: true,
    });
  }
  return NextResponse.json(
    workspaceRunProjection(persisted.value, effectiveConfig.value.datasource.resource_id),
    { status: 201 },
  );
}
