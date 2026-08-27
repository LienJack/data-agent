import { createHash } from "node:crypto";
import { normalizeRootAgentProviderTurn } from "@data-agent/agent-runtime";
import {
  effectiveConfigRunLeasePayloadSchema,
  type PortResult,
  type RootAgentDecisionCandidate,
  type RootToolObservation,
  type RootVerifierFeedback,
  rootAgentToolResultSchema,
  rootVerifierFeedbackSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  hasRunExecutionContextProvenance,
  hasRunProviderDispatchCapability,
} from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";

function sameScope(
  left: Readonly<{ app_id: string; tenant_id: string; environment: string }>,
  right: Readonly<{ app_id: string; tenant_id: string; environment: string }>,
): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function identity(runId: string, turnIndex: number): string {
  const bytes = createHash("sha256")
    .update(`data-agent/root-agent-turn@2\0root:${runId}:${turnIndex}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function failure(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

export interface RootAgentTurnPort {
  decide(
    input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    state: RootAgentTurnState,
  ): Promise<PortResult<RootAgentDecisionCandidate>>;
}

const rootAgentTurnStateSchema = z.strictObject({
  turn_index: z.number().int().nonnegative().max(3),
  tool_observations: z.array(rootAgentToolResultSchema).max(32),
  verifier_feedback: rootVerifierFeedbackSchema.nullable(),
});

export type RootAgentTurnState = Readonly<{
  turn_index: number;
  tool_observations: readonly RootToolObservation[];
  verifier_feedback: RootVerifierFeedback | null;
}>;

export function createRootAgentTurnExecutor(): RootAgentTurnPort {
  return Object.freeze({
    async decide(
      input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
      stateInput: RootAgentTurnState,
    ): Promise<PortResult<RootAgentDecisionCandidate>> {
      if (!hasRunExecutionContextProvenance(input.context)) {
        return failure("RUN_EXECUTION_CONTEXT_NOT_TRUSTED", "Root Agent context is not trusted.");
      }
      const payload = effectiveConfigRunLeasePayloadSchema.safeParse(input.lease.payload);
      if (
        !payload.success ||
        payload.data.kind !== "START_DATA_AGENT_TEAM" ||
        payload.data.schema_version !== "effective-config-team-lease@3.0.0" ||
        payload.data.executor_version !== "ROOT_HARNESS@1" ||
        payload.data.catalog_snapshot.run_id !== input.lease.run_id
      ) {
        return failure(
          "ROOT_AGENT_LEASE_INVALID",
          "Root Agent requires an exact v3 catalog lease.",
        );
      }
      const config = input.context.getEffectiveConfig();
      const contextReceipt = input.context.getContextReceipt();
      const configRef = payload.data.effective_config_ref;
      if (
        config.run_id !== input.lease.run_id ||
        !sameScope(config.scope, input.lease.scope) ||
        config.scope.principal_id !== input.lease.principal_id ||
        config.config_id !== configRef.config_id ||
        config.config_revision !== configRef.config_revision ||
        config.config_hash !== configRef.config_hash
      ) {
        return failure(
          "ROOT_AGENT_EFFECTIVE_CONFIG_BINDING_INVALID",
          "Root Agent Effective Config does not match the frozen Run lease.",
        );
      }
      if (
        payload.data.catalog_snapshot.principal_id !== input.lease.principal_id ||
        !sameScope(payload.data.catalog_snapshot.scope, input.lease.scope)
      ) {
        return failure(
          "ROOT_AGENT_CATALOG_BINDING_INVALID",
          "Root Agent catalog does not match the frozen Run authority.",
        );
      }
      if (
        contextReceipt.run_id !== input.lease.run_id ||
        contextReceipt.attempt_id !== input.lease.attempt_id ||
        contextReceipt.worker_fence !== input.lease.worker_fence ||
        contextReceipt.config_ref.config_id !== configRef.config_id ||
        contextReceipt.config_ref.config_revision !== configRef.config_revision ||
        contextReceipt.config_ref.config_hash !== configRef.config_hash ||
        contextReceipt.semantic_release.resource_id !== config.semantic_release.resource_id ||
        contextReceipt.semantic_release.resource_hash !== config.semantic_release.resource_hash ||
        contextReceipt.schema_snapshot.resource_id !== config.schema_snapshot.resource_id ||
        contextReceipt.schema_snapshot.resource_hash !== config.schema_snapshot.resource_hash
      ) {
        return failure(
          "ROOT_AGENT_CONTEXT_BINDING_INVALID",
          "Root Agent context receipt drifted from the frozen schema or semantic binding.",
        );
      }
      const catalog = payload.data.catalog_snapshot;
      const state = rootAgentTurnStateSchema.safeParse(stateInput);
      if (!state.success || state.data.turn_index >= input.lease.execution_policy.max_root_turns) {
        return failure(
          "ROOT_AGENT_TURN_STATE_INVALID",
          "Root Agent turn state exceeds the frozen normal-turn budget.",
        );
      }
      const provider = input.context.getProviderDispatchCapability();
      if (!hasRunProviderDispatchCapability(provider)) {
        return failure("ROOT_AGENT_PROVIDER_REQUIRED", "Root Agent Provider capability is absent.");
      }
      try {
        const invoked = await provider.invoke({
          logical_call_id: identity(input.lease.run_id, state.data.turn_index),
          turn: {
            kind: "ROOT",
            turn_index: state.data.turn_index,
            tool_observations: state.data.tool_observations,
            verifier_feedback: state.data.verifier_feedback,
          },
        });
        if (!invoked.ok) throw new RootAgentTurnProviderError(invoked.error);
        return {
          ok: true,
          value: await normalizeRootAgentProviderTurn({
            scope: input.lease.scope,
            run_id: input.lease.run_id,
            catalog,
            output_text: invoked.value.output_text,
            tool_calls: invoked.value.tool_calls,
          }),
        };
      } catch (error) {
        if (error instanceof RootAgentTurnProviderError) {
          return { ok: false as const, error: error.failure };
        }
        return failure(
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : "ROOT_AGENT_RESPONSE_INVALID",
          "Root Agent Provider turn failed local Harness validation.",
        );
      }
    },
  });
}

class RootAgentTurnProviderError extends Error {
  override readonly name = "RootAgentTurnProviderError";

  constructor(readonly failure: Readonly<{ code: string; message: string; retryable: boolean }>) {
    super(failure.code);
  }
}
