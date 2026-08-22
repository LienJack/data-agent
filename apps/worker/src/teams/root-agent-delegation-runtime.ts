import {
  admitRootAgentDelegations,
  type SubagentAdmissionBudget,
  SubagentDelegationAdmissionError,
} from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItem,
  type AgentProductProfileRegistryItemV2,
  type ArtifactReference,
  agentSpecialistProfileIdSchema,
  effectiveConfigRunLeasePayloadSchema,
  type PortResult,
  type ProductTeamArtifactDocument,
  type ResolvedContextCommitResult,
  type RootAgentDecisionCandidate,
  verifyResolvedContextCommitResult,
} from "@data-agent/contracts";
import { hasRunResolvedContextCapability } from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";
import type {
  DataAgentProductTeamRuntimePort,
  DataAgentTeamRunnerDependencies,
} from "./data-agent-team-runner.js";
import { verifySelectedProductProfiles } from "./mastra-profile-composition.js";
import { createRootAnswerVerifier } from "./root-answer-verifier.js";

type RootExecution = Parameters<RunWorkflowExecutorPort["execute"]>[0];

export interface RootAgentDelegationRuntimeDependencies {
  readonly profiles: {
    listEnabled(
      capabilityInput: unknown,
    ): Promise<PortResult<readonly AgentProductProfileRegistryItem[]>>;
    listDiscoverable(
      capabilityInput: unknown,
    ): Promise<PortResult<readonly AgentProductProfileRegistryItemV2[]>>;
  };
  readonly profile_capability_input: unknown;
  readonly runtime: DataAgentProductTeamRuntimePort;
  readonly artifacts: {
    verifyCommitted(reference: ArtifactReference): Promise<PortResult<boolean>>;
    resolveCommitted(
      reference: ArtifactReference,
    ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
  };
}

class RootAgentDelegationRuntimeError extends Error {
  override readonly name = "RootAgentDelegationRuntimeError";

  constructor(readonly code: string) {
    super(code);
  }
}

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new RootAgentDelegationRuntimeError(result.error.code);
  return result.value;
}

async function emit(
  execution: RootExecution,
  event: Parameters<NonNullable<RootExecution["context"]["emitDisplayEvent"]>>[0],
) {
  if (!execution.context.emitDisplayEvent) {
    throw new RootAgentDelegationRuntimeError("RUN_DISPLAY_EVENT_REQUIRED");
  }
  value(await execution.context.emitDisplayEvent(event));
}

function runCeiling(execution: RootExecution): SubagentAdmissionBudget {
  const config = execution.context.getEffectiveConfig();
  return {
    timeout_ms: Math.min(600_000, config.execution_safety_policy.max_elapsed_ms),
    max_steps: Math.max(1, Math.min(128, config.execution_safety_policy.max_tool_calls + 1)),
    max_input_tokens: Math.max(1, Math.min(2_000_000, config.context_policy.max_context_tokens)),
    max_output_tokens: Math.max(1, Math.min(4_096, config.context_policy.max_context_tokens)),
    max_tool_calls: Math.min(1_000, config.execution_safety_policy.max_tool_calls),
    max_context_bytes: 65_536,
  };
}

function profileCeiling(
  profile: AgentProductProfileRegistryItemV2,
  ceiling: SubagentAdmissionBudget,
): SubagentAdmissionBudget {
  return {
    ...ceiling,
    max_steps: Math.min(ceiling.max_steps, profile.revision.direct_tool_allowlist.length + 1),
    max_tool_calls: Math.min(ceiling.max_tool_calls, profile.revision.direct_tool_allowlist.length),
  };
}

async function resolveContext(execution: RootExecution): Promise<ResolvedContextCommitResult> {
  const capability = execution.context.getResolvedContextCapability?.();
  if (!hasRunResolvedContextCapability(capability)) {
    throw new RootAgentDelegationRuntimeError("RESOLVED_CONTEXT_REQUIRED");
  }
  const resolved = value(await capability.resolve());
  try {
    const context = await verifyResolvedContextCommitResult(resolved);
    const metadataFallback =
      context.package.route_decision.state === "REJECTED" &&
      context.package.route_decision.route === "NONE" &&
      context.package.route_decision.reason_codes.length === 1 &&
      context.package.route_decision.reason_codes[0] === "NO_GOVERNED_CONTEXT_ROUTE";
    if (!["READY", "PARTIAL"].includes(context.package.route_decision.state) && !metadataFallback) {
      throw new RootAgentDelegationRuntimeError("RESOLVED_CONTEXT_NOT_RUNNABLE");
    }
    return context;
  } catch (error) {
    if (error instanceof RootAgentDelegationRuntimeError) throw error;
    throw new RootAgentDelegationRuntimeError("RESOLVED_CONTEXT_RESULT_INVALID");
  }
}

function selectLegacyRuntimeProfiles(input: {
  readonly admitted: Awaited<ReturnType<typeof admitRootAgentDelegations>>;
  readonly legacy: ReadonlyMap<string, AgentProductProfileRegistryItem>;
}) {
  const selected = new Map<
    ReturnType<typeof agentSpecialistProfileIdSchema.parse>,
    AgentProductProfileRegistryItem
  >();
  for (const delegation of input.admitted) {
    let profileId: ReturnType<typeof agentSpecialistProfileIdSchema.parse>;
    try {
      profileId = agentSpecialistProfileIdSchema.parse(delegation.profile.revision.profile_id);
    } catch {
      throw new RootAgentDelegationRuntimeError("SUBAGENT_RUNTIME_PROFILE_UNSUPPORTED");
    }
    const legacy = input.legacy.get(profileId);
    const v2Runtime = delegation.profile.revision.runtime_profile_ref;
    if (
      !legacy ||
      legacy.revision.runtime_profile_ref.profile_id !== v2Runtime.profile_id ||
      legacy.revision.runtime_profile_ref.revision !== v2Runtime.revision ||
      legacy.revision.runtime_profile_ref.profile_hash !== v2Runtime.profile_hash ||
      JSON.stringify(legacy.revision.direct_tool_allowlist) !==
        JSON.stringify(delegation.receipt.tool_allowlist)
    ) {
      throw new RootAgentDelegationRuntimeError("SUBAGENT_RUNTIME_PROFILE_BINDING_STALE");
    }
    selected.set(profileId, legacy);
  }
  return selected;
}

export function createRootAgentDelegationRuntime(
  dependencies: RootAgentDelegationRuntimeDependencies,
): NonNullable<DataAgentTeamRunnerDependencies["root_runtime"]> {
  const answerVerifier = createRootAnswerVerifier({
    artifacts: { resolveCommitted: dependencies.artifacts.resolveCommitted },
  });
  return Object.freeze({
    async execute(input: {
      readonly decision: RootAgentDecisionCandidate;
      readonly execution: RootExecution;
    }) {
      try {
        const payload = effectiveConfigRunLeasePayloadSchema.parse(input.execution.lease.payload);
        if (
          payload.kind !== "START_DATA_AGENT_TEAM" ||
          payload.schema_version !== "effective-config-team-lease@3.0.0" ||
          input.decision.run_id !== input.execution.lease.run_id
        ) {
          throw new RootAgentDelegationRuntimeError("ROOT_AGENT_LEASE_INVALID");
        }
        if (input.decision.kind === "FINAL_ANSWER") {
          const verification = await answerVerifier.verify({
            decision: input.decision,
            visible_message_refs: payload.visible_message_refs,
            accepted_artifact_refs: [],
          });
          if (verification.status !== "ACCEPTED") {
            throw new RootAgentDelegationRuntimeError(verification.reason_code);
          }
          await emit(input.execution, {
            kind: "answer_delta",
            key: "root.answer.direct",
            delta: verification.rendered_text,
          });
          return { status: "ACCEPTED", reason_code: "ROOT_DIRECT_ANSWER_ACCEPTED" };
        }

        const discoverable = value(
          await dependencies.profiles.listDiscoverable(dependencies.profile_capability_input),
        );
        const ceiling = runCeiling(input.execution);
        const admitted = await admitRootAgentDelegations({
          decision: input.decision,
          catalog: payload.catalog_snapshot,
          profiles: discoverable,
          run_ceiling: ceiling,
          profile_ceiling: (profile) => profileCeiling(profile, ceiling),
          artifact_is_accepted: async (reference) =>
            value(await dependencies.artifacts.verifyCommitted(reference)),
        });
        if (admitted.length === 0) {
          throw new RootAgentDelegationRuntimeError("ROOT_AGENT_EMPTY_DELEGATION");
        }

        const legacyItems = value(
          await dependencies.profiles.listEnabled(dependencies.profile_capability_input),
        );
        const legacy = await verifySelectedProductProfiles(legacyItems);
        const profiles = selectLegacyRuntimeProfiles({ admitted, legacy });
        const context = await resolveContext(input.execution);
        const result = await dependencies.runtime.execute({
          lease: input.execution.lease,
          profiles,
          dispatch_plan: null,
          admitted_delegations: admitted,
          resolved_context_ref: {
            package_id: context.package.package_id,
            package_hash: context.package.package_hash,
            receipt_id: context.receipt.receipt_id,
            receipt_hash: context.receipt.receipt_hash,
            semantic_domain: context.package.semantic_domain,
            semantic_release_id: context.package.semantic_release.resource_id,
            semantic_release_hash: context.package.semantic_release.resource_hash,
          },
          restored_snapshot: input.execution.restored_snapshot,
          execution_context: input.execution.context,
          signal: input.execution.signal,
          deadline_at: input.execution.deadline_at,
        });
        return result;
      } catch (error) {
        const reasonCode =
          error instanceof RootAgentDelegationRuntimeError ||
          error instanceof SubagentDelegationAdmissionError
            ? error.code
            : error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message)
              ? error.message
              : "ROOT_AGENT_DELEGATION_RUNTIME_FAILED";
        return { status: "FAILED", reason_code: reasonCode };
      }
    },
  });
}
