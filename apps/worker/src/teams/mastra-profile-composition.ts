import {
  type DataAgentSpecialistProfileId,
  dataAgentSpecialistProfileIdSchema,
  getAgentProfileRevisionExact,
  type TeamTaskV2,
  TeamWorkflowRegistry,
} from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactReference,
  artifactReferenceIdentity,
  type PortResult,
  verifyAgentProductProfileRevisionV2,
} from "@data-agent/contracts";
import type { RunDisplayEventInput } from "../runs/run-worker-runner.js";

export interface ProductProfileToolResult {
  readonly output_ref: ArtifactReference | null;
  readonly public_artifact_refs: readonly ArtifactReference[];
}

export interface ProductProfileToolPort {
  invoke(input: {
    readonly task: TeamTaskV2;
    readonly profile: AgentProductProfileRegistryItemV2;
    readonly tool_id: string;
    readonly context_epoch: Readonly<{ epoch_id: string; build_signature: string }>;
    readonly signal?: AbortSignal;
  }): Promise<ArtifactReference | null | ProductProfileToolResult>;
}

export interface ProductProfileToolVisibilityPort {
  emit(input: RunDisplayEventInput): Promise<PortResult<{ readonly sequence: number }>>;
}

class ProductProfileToolVisibilityError extends Error {
  override readonly name = "ProductProfileToolVisibilityError";

  constructor(readonly code: string) {
    super(code);
  }
}

function normalizeToolResult(
  result: ArtifactReference | null | ProductProfileToolResult,
  task: TeamTaskV2,
): ProductProfileToolResult {
  const normalized =
    result && "output_ref" in result
      ? result
      : { output_ref: result, public_artifact_refs: result ? [result] : [] };
  const refs = new Map<string, ArtifactReference>();
  for (const reference of normalized.public_artifact_refs) {
    if (
      reference.run_id !== task.run_id ||
      reference.app_id !== task.scope.app_id ||
      reference.tenant_id !== task.scope.tenant_id ||
      reference.environment !== task.scope.environment
    ) {
      throw new TypeError("TEAM_TOOL_PUBLIC_ARTIFACT_SCOPE_INVALID");
    }
    refs.set(artifactReferenceIdentity(reference), reference);
  }
  if (normalized.output_ref) {
    refs.set(artifactReferenceIdentity(normalized.output_ref), normalized.output_ref);
  }
  return Object.freeze({
    output_ref: normalized.output_ref,
    public_artifact_refs: Object.freeze([...refs.values()]),
  });
}

function visibleToolErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)) {
    return error.message;
  }
  return "TEAM_TOOL_EXECUTION_FAILED";
}

function visibleToolPort(input: {
  readonly tools: ProductProfileToolPort;
  readonly visibility: ProductProfileToolVisibilityPort;
  readonly now: () => number;
}): ProductProfileToolPort {
  return {
    async invoke(invocation) {
      const profileId = dataAgentSpecialistProfileIdSchema.parse(
        invocation.profile.revision.profile_id,
      );
      const callId = `${invocation.task.task_id}:${invocation.tool_id}`;
      const key = `team.tool.${invocation.task.task_id}.${invocation.tool_id}`;
      const startedAt = input.now();
      const started = await input.visibility.emit({
        kind: "tool_started",
        key: `${key}.started`,
        call_id: callId,
        tool_name: invocation.tool_id,
        title: invocation.tool_id,
        summary: `${profileId} 正在调用受治理工具`,
        profile_id: profileId,
        task_id: invocation.task.task_id,
        artifact_refs: [],
        input: JSON.stringify({
          profile_id: profileId,
          task_id: invocation.task.task_id,
          tool_id: invocation.tool_id,
        }),
      });
      if (!started.ok) throw new ProductProfileToolVisibilityError(started.error.code);
      try {
        const result = normalizeToolResult(await input.tools.invoke(invocation), invocation.task);
        const completed = await input.visibility.emit({
          kind: "tool_completed",
          key: `${key}.completed`,
          call_id: callId,
          tool_name: invocation.tool_id,
          summary: "受治理工具调用已完成",
          profile_id: profileId,
          task_id: invocation.task.task_id,
          artifact_refs: [...result.public_artifact_refs],
          output: result.output_ref
            ? JSON.stringify({
                artifact_id: result.output_ref.artifact_id,
                artifact_type: result.output_ref.artifact_type,
                revision: result.output_ref.revision,
                content_hash: result.output_ref.content_hash,
              })
            : null,
          duration_ms: Math.max(0, input.now() - startedAt),
        });
        if (!completed.ok) throw new ProductProfileToolVisibilityError(completed.error.code);
        return result;
      } catch (error) {
        if (error instanceof ProductProfileToolVisibilityError) throw error;
        const failed = await input.visibility.emit({
          kind: "tool_failed",
          key: `${key}.failed`,
          call_id: callId,
          tool_name: invocation.tool_id,
          summary: "受治理工具调用失败",
          error_code: visibleToolErrorCode(error),
          profile_id: profileId,
          task_id: invocation.task.task_id,
          artifact_refs: [],
          output: null,
          duration_ms: Math.max(0, input.now() - startedAt),
        });
        if (!failed.ok) throw new ProductProfileToolVisibilityError(failed.error.code);
        throw error;
      }
    },
  };
}

export async function verifySelectedProductProfiles(
  items: readonly AgentProductProfileRegistryItemV2[],
): Promise<ReadonlyMap<DataAgentSpecialistProfileId, AgentProductProfileRegistryItemV2>> {
  const profiles = new Map<DataAgentSpecialistProfileId, AgentProductProfileRegistryItemV2>();
  for (const item of items) {
    const revision = await verifyAgentProductProfileRevisionV2(item.revision);
    const profileId = dataAgentSpecialistProfileIdSchema.safeParse(revision.profile_id);
    if (!profileId.success) {
      throw new TypeError("SUBAGENT_RUNTIME_PROFILE_UNSUPPORTED");
    }
    let runtime: ReturnType<typeof getAgentProfileRevisionExact>;
    try {
      runtime = getAgentProfileRevisionExact(
        profileId.data,
        revision.runtime_profile_ref.revision,
        revision.runtime_profile_ref.profile_hash,
      );
    } catch {
      throw new TypeError("TEAM_PRODUCT_PROFILE_RUNTIME_REVISION_UNKNOWN");
    }
    if (
      item.head.lifecycle !== "ENABLED" ||
      revision.approval_status !== "APPROVED" ||
      item.head.active_revision !== revision.revision ||
      item.head.active_revision_hash !== revision.revision_hash ||
      revision.runtime_profile_ref.revision !== runtime.revision ||
      revision.runtime_profile_ref.profile_hash !== runtime.profile_hash ||
      JSON.stringify(revision.direct_tool_allowlist) !==
        JSON.stringify([...runtime.direct_tool_allowlist].sort())
    ) {
      throw new TypeError("TEAM_PRODUCT_PROFILE_NOT_CURRENT");
    }
    if (profiles.has(profileId.data)) {
      throw new TypeError("TEAM_PRODUCT_PROFILE_DUPLICATE");
    }
    profiles.set(profileId.data, item);
  }
  return profiles;
}

export async function createMastraProfileComposition(input: {
  readonly profiles: readonly AgentProductProfileRegistryItemV2[];
  readonly tools: ProductProfileToolPort;
  readonly visibility: ProductProfileToolVisibilityPort;
  readonly now?: () => number;
  readonly execution_tool_allowlists?: Partial<
    Record<DataAgentSpecialistProfileId, readonly string[]>
  >;
}): Promise<TeamWorkflowRegistry> {
  const profiles = await verifySelectedProductProfiles(input.profiles);
  const tools = visibleToolPort({
    tools: input.tools,
    visibility: input.visibility,
    now: input.now ?? Date.now,
  });
  const registry = new TeamWorkflowRegistry();
  for (const [profileId, productProfile] of profiles) {
    const runtimeProfile = getAgentProfileRevisionExact(
      profileId,
      productProfile.revision.runtime_profile_ref.revision,
      productProfile.revision.runtime_profile_ref.profile_hash,
    );
    registry.register(runtimeProfile, async ({ task, context_epoch, signal }) => {
      let output: ArtifactReference | null = null;
      const executionTools =
        input.execution_tool_allowlists?.[profileId] ??
        productProfile.revision.direct_tool_allowlist;
      if (
        executionTools.some(
          (toolId) => !productProfile.revision.direct_tool_allowlist.includes(toolId),
        )
      ) {
        throw new TypeError("TEAM_EXECUTION_TOOL_ALLOWLIST_ESCALATION");
      }
      for (const toolId of executionTools) {
        if (!runtimeProfile.direct_tool_allowlist.includes(toolId)) {
          throw new TypeError("TEAM_DIRECT_TOOL_DENIED");
        }
        const candidate = normalizeToolResult(
          await tools.invoke({
            task,
            profile: productProfile,
            tool_id: toolId,
            context_epoch,
            ...(signal ? { signal } : {}),
          }),
          task,
        );
        if (candidate.output_ref) output = candidate.output_ref;
      }
      if (!output || !task.acceptance.required_artifact_types.includes(output.artifact_type)) {
        return { status: "FAILED", task_id: task.task_id, output_ref: null };
      }
      return { status: "COMPLETED", task_id: task.task_id, output_ref: output };
    });
  }
  return registry;
}
