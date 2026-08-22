import {
  buildRunConfigRequestCandidate,
  qaRunStartInputSchema,
  workspaceFileReferenceSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { createPostgresRepository, freezeSubagentCapabilityCatalog } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveRunCommandIdentities } from "@/lib/run-command-identity";
import {
  getAgentDispatchAuthority,
  getAgentProfileRegistry,
  getEffectiveConfigResolver,
  getProviderInvocationStore,
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceFiles,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";
import { workspaceRunProjection } from "@/lib/workspace-run";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

const inherited = { mode: "INHERIT_DEFAULT" } as const;
const effectiveConfigQaRunStartInputSchema = qaRunStartInputSchema.extend({
  idempotency_key: workspaceIdempotencyKeySchema,
  files: z.array(workspaceFileReferenceSchema).max(16).default([]),
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = effectiveConfigQaRunStartInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return workspaceErrorResponse({
      code: "RUN_INPUT_INVALID",
      message: "问题或幂等键不符合契约。",
      retryable: false,
    });
  }

  const conversationIdResult = z.uuid().safeParse(conversationId);
  if (!conversationIdResult.success) {
    return workspaceErrorResponse({
      code: "CONVERSATION_NOT_FOUND_OR_DENIED",
      message: "对话不存在或无权访问。",
      retryable: false,
    });
  }
  const conversation = await getWorkspaceDataRepository().getConversation(
    authorized.value.capability,
    conversationIdResult.data,
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
  const orderedFiles = [...input.data.files].sort((left, right) =>
    left.file_id.localeCompare(right.file_id),
  );
  if (new Set(orderedFiles.map((file) => file.file_id)).size !== orderedFiles.length) {
    return workspaceErrorResponse({
      code: "RUN_INPUT_INVALID",
      message: "附件引用不得重复。",
      retryable: false,
    });
  }
  for (const fileRef of orderedFiles) {
    const file = await getWorkspaceFiles().get(authorized.value.capability, fileRef);
    if (!file.ok) return workspaceErrorResponse(file.error);
    if (file.value?.status !== "READY") {
      return workspaceErrorResponse({
        code: "WORKSPACE_FILE_NOT_AVAILABLE",
        message: "附件尚未通过扫描或已不可用。",
        retryable: false,
      });
    }
  }
  const [defaults, selections, profiles] = await Promise.all([
    resolver.getWorkspaceDefaults(authorized.value.capability),
    getProviderInvocationStore().resolveConversationRunSelections(authorized.value.capability, {
      conversation_id: conversation.value.conversation_id,
      expected_resource_version: conversationVersion.data,
    }),
    getAgentProfileRegistry().listDiscoverable(authorized.value.capability),
  ]);
  if (!defaults.ok) return workspaceErrorResponse(defaults.error);
  if (!selections.ok) return workspaceErrorResponse(selections.error);
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
    idempotency_key: input.data.idempotency_key,
  });
  const runId = identities.run_id;
  const rollout = await getAgentDispatchAuthority().resolveRolloutPolicy(
    authorized.value.capability,
    process.env.DATA_AGENT_DISPATCH_BOOTSTRAP_MODE,
  );
  if (!rollout.ok) return workspaceErrorResponse(rollout.error);
  const catalogSnapshot = await freezeSubagentCapabilityCatalog({
    run_id: runId,
    scope: authorized.value.capability.scope,
    principal_id: authorized.value.capability.principal,
    enabled_profiles: profiles.value,
    policy_version: rollout.value.policy_version,
  });
  const configRequest = await buildRunConfigRequestCandidate({
    schema_version: "run-config-request@1.0.0",
    operation: "QUESTION_RUN",
    workspace_id: workspaceId,
    run_id: runId,
    idempotency_key: input.data.idempotency_key,
    conversation_ref: {
      conversation_id: conversation.value.conversation_id,
      expected_resource_version: conversationVersion.data,
    },
    defaults_ref: defaults.value.defaults_ref,
    overrides: {
      model: {
        mode: "RESOURCE_IDS",
        resources: [
          {
            resource_id: selections.value.model_profile_id,
            expected_revision: selections.value.model_config_version,
          },
        ],
      },
      datasource: {
        mode: "RESOURCE_IDS",
        resources: [
          {
            resource_id: selections.value.datasource_id,
            expected_revision: selections.value.datasource_resource_version,
          },
        ],
      },
      files:
        orderedFiles.length === 0
          ? inherited
          : {
              mode: "RESOURCE_IDS",
              resources: orderedFiles.map((file) => ({
                resource_id: file.file_id,
                expected_revision: file.revision,
              })),
            },
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
      idempotency_key: input.data.idempotency_key,
      question: input.data.question,
      subagent_catalog_snapshot: catalogSnapshot,
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
