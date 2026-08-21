import {
  assertDirectToolAllowed,
  getAgentProfileRevision,
  type TeamTaskV2,
  TeamWorkflowRegistry,
} from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItem,
  type AgentSpecialistProfileId,
  type ArtifactReference,
  type PortResult,
  verifyAgentProductProfileRevision,
} from "@data-agent/contracts";
import type { RunDisplayEventInput } from "../runs/run-worker-runner.js";

export interface ProductProfileToolPort {
  invoke(input: {
    readonly task: TeamTaskV2;
    readonly profile: AgentProductProfileRegistryItem;
    readonly tool_id: string;
    readonly context_epoch: Readonly<{ epoch_id: string; build_signature: string }>;
    readonly signal?: AbortSignal;
  }): Promise<ArtifactReference | null>;
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

function visibleToolPort(input: {
  readonly tools: ProductProfileToolPort;
  readonly visibility: ProductProfileToolVisibilityPort;
  readonly now: () => number;
}): ProductProfileToolPort {
  return {
    async invoke(invocation) {
      const callId = `${invocation.task.task_id}:${invocation.tool_id}`;
      const key = `team.tool.${invocation.task.task_id}.${invocation.tool_id}`;
      const startedAt = input.now();
      const started = await input.visibility.emit({
        kind: "tool_started",
        key: `${key}.started`,
        call_id: callId,
        tool_name: invocation.tool_id,
        title: invocation.tool_id,
        summary: `${invocation.profile.revision.profile_id} 正在调用受治理工具`,
        profile_id: invocation.profile.revision.profile_id,
        task_id: invocation.task.task_id,
        artifact_refs: [],
        input: JSON.stringify({
          profile_id: invocation.profile.revision.profile_id,
          task_id: invocation.task.task_id,
          tool_id: invocation.tool_id,
        }),
      });
      if (!started.ok) throw new ProductProfileToolVisibilityError(started.error.code);
      try {
        const result = await input.tools.invoke(invocation);
        const completed = await input.visibility.emit({
          kind: "tool_completed",
          key: `${key}.completed`,
          call_id: callId,
          tool_name: invocation.tool_id,
          summary: "受治理工具调用已完成",
          profile_id: invocation.profile.revision.profile_id,
          task_id: invocation.task.task_id,
          artifact_refs: result ? [result] : [],
          output: result
            ? JSON.stringify({
                artifact_id: result.artifact_id,
                artifact_type: result.artifact_type,
                revision: result.revision,
                content_hash: result.content_hash,
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
          error_code: "TEAM_TOOL_EXECUTION_FAILED",
          profile_id: invocation.profile.revision.profile_id,
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

const profileIds = [
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

export async function verifyProductProfileSet(
  items: readonly AgentProductProfileRegistryItem[],
): Promise<ReadonlyMap<AgentSpecialistProfileId, AgentProductProfileRegistryItem>> {
  if (
    items.length !== profileIds.length ||
    items.some(({ revision }, index) => revision.profile_id !== profileIds[index])
  ) {
    throw new TypeError("TEAM_PRODUCT_PROFILE_SET_INCOMPLETE");
  }
  const profiles = new Map<AgentSpecialistProfileId, AgentProductProfileRegistryItem>();
  for (const item of items) {
    const revision = await verifyAgentProductProfileRevision(item.revision);
    const runtime = getAgentProfileRevision(revision.profile_id);
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
    profiles.set(revision.profile_id, item);
  }
  return profiles;
}

export async function createMastraProfileComposition(input: {
  readonly profiles: readonly AgentProductProfileRegistryItem[];
  readonly tools: ProductProfileToolPort;
  readonly visibility: ProductProfileToolVisibilityPort;
  readonly now?: () => number;
}): Promise<TeamWorkflowRegistry> {
  const profiles = await verifyProductProfileSet(input.profiles);
  const tools = visibleToolPort({
    tools: input.tools,
    visibility: input.visibility,
    now: input.now ?? Date.now,
  });
  const registry = new TeamWorkflowRegistry();
  for (const profileId of profileIds) {
    const productProfile = profiles.get(profileId);
    if (!productProfile) throw new TypeError("TEAM_PRODUCT_PROFILE_SET_INCOMPLETE");
    const runtimeProfile = getAgentProfileRevision(profileId);
    registry.register(runtimeProfile, async ({ task, context_epoch, signal }) => {
      let output: ArtifactReference | null = null;
      for (const toolId of productProfile.revision.direct_tool_allowlist) {
        assertDirectToolAllowed(profileId, toolId);
        const candidate = await tools.invoke({
          task,
          profile: productProfile,
          tool_id: toolId,
          context_epoch,
          ...(signal ? { signal } : {}),
        });
        if (candidate) output = candidate;
      }
      if (!output || !task.acceptance.required_artifact_types.includes(output.artifact_type)) {
        return { status: "FAILED", task_id: task.task_id, output_ref: null };
      }
      return { status: "COMPLETED", task_id: task.task_id, output_ref: output };
    });
  }
  return registry;
}
