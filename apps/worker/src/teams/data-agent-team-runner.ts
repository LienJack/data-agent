import { createHash } from "node:crypto";
import type { AdmittedSubagentDelegation } from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactReference,
  canonicalizeJson,
  effectiveConfigRunLeasePayloadSchema,
  type Falcon24AuthorityBinding,
  type Falcon24AuthorityBindingV2,
  type PortResult,
  type RootAgentDecisionCandidate,
  type RootToolObservation,
  type RootVerifierFeedback,
  rootAgentToolResultSchema,
  rootVerifierFeedbackSchema,
  type SemanticContextCommitResult,
  type SubagentCapabilityCatalogSnapshot,
} from "@data-agent/contracts";
import { z } from "zod";
import { hasRunExecutionContextProvenance } from "../runs/run-execution-context.js";
import {
  type RunExecutionContext,
  type RunExecutorResult,
  type RunWorkflowExecutorPort,
  runExecutorResultSchema,
} from "../runs/run-worker-runner.js";
import type { RootAgentTurnPort } from "./root-agent-turn-executor.js";

const reasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);

const rootRuntimeResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ACCEPTED"), reason_code: reasonCodeSchema }),
  z.strictObject({
    status: z.literal("CONTINUE"),
    reason_code: reasonCodeSchema,
    observations: z.array(rootAgentToolResultSchema).max(8),
    verifier_feedback: rootVerifierFeedbackSchema.nullable(),
  }),
  z.strictObject({
    status: z.enum(["FAILED", "NEEDS_CLARIFICATION"]),
    reason_code: reasonCodeSchema,
  }),
]);

const ROOT_LOOP_WORKFLOW_ID = "root-agent-tool-loop@1.0.0";
const ROOT_LOOP_WORKFLOW_REVISION = `sha256:${createHash("sha256")
  .update("data-agent/root-agent-tool-loop@1.0.0")
  .digest("hex")}`;

const rootLoopStateSchema = z
  .strictObject({
    schema_version: z.literal("root-agent-loop-state@1.0.0"),
    runId: z.string().min(1).max(128),
    turn_index: z.number().int().nonnegative().max(4),
    accepted_tool_observations: z.array(rootAgentToolResultSchema).max(32),
    verifier_feedback: rootVerifierFeedbackSchema.nullable(),
    terminal: z.boolean(),
    terminal_error_code: reasonCodeSchema.nullable(),
  })
  .superRefine((state, ctx) => {
    if (!state.terminal && state.terminal_error_code !== null) {
      ctx.addIssue({
        code: "custom",
        message: "An active Root loop cannot carry a terminal error.",
        path: ["terminal_error_code"],
      });
    }
    const ids = state.accepted_tool_observations.map(({ tool_call_id: toolCallId }) => toolCallId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Root loop observations must have unique tool call IDs.",
        path: ["accepted_tool_observations"],
      });
    }
  });

type RootLoopState = z.infer<typeof rootLoopStateSchema>;

export interface DataAgentProductTeamRuntimePort {
  execute(input: {
    readonly lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"];
    readonly root_turn_index: number;
    readonly authority: Falcon24AuthorityBindingV2;
    readonly profiles: ReadonlyMap<string, AgentProductProfileRegistryItemV2>;
    readonly admitted_delegations: readonly AdmittedSubagentDelegation[];
    readonly semantic_context_ref: Readonly<{
      package_id: string;
      package_hash: string;
      receipt_id: string;
      receipt_hash: string;
      semantic_domain: string;
      semantic_release_id: string;
      semantic_release_hash: string;
    }>;
    readonly semantic_context_package: SemanticContextCommitResult["package"];
    readonly semantic_context: SemanticContextCommitResult;
    readonly restored_snapshot: Parameters<
      RunWorkflowExecutorPort["execute"]
    >[0]["restored_snapshot"];
    readonly execution_context: RunExecutionContext;
    readonly signal: AbortSignal;
    readonly deadline_at: string;
  }): Promise<
    Readonly<
      | {
          status: "COMPLETED";
          reason_code: string;
          observations: readonly RootToolObservation[];
        }
      | { status: "FAILED"; reason_code: string }
    >
  >;
}

export interface DataAgentTeamRunnerDependencies {
  readonly authority?: {
    loadCurrent(): Promise<PortResult<Falcon24AuthorityBinding | null>>;
    loadRunBinding(runId: string): Promise<PortResult<Falcon24AuthorityBinding>>;
  };
  readonly catalog_authority?: {
    loadFrozen(
      catalog: SubagentCapabilityCatalogSnapshot,
    ): Promise<PortResult<readonly AgentProductProfileRegistryItemV2[]>>;
  };
  readonly root?: RootAgentTurnPort;
  readonly root_runtime?: {
    execute(input: {
      readonly decision: RootAgentDecisionCandidate;
      readonly turn_index: number;
      readonly accepted_artifact_refs: readonly ArtifactReference[];
      readonly execution: Parameters<RunWorkflowExecutorPort["execute"]>[0];
      readonly profiles: readonly AgentProductProfileRegistryItemV2[];
      readonly authority: Falcon24AuthorityBindingV2;
    }): Promise<unknown>;
  };
}

function failed(errorCode: string): RunExecutorResult {
  return runExecutorResultSchema.parse({ kind: "FAILED", error_code: errorCode });
}

function sameAuthorityBinding(
  left: Falcon24AuthorityBinding,
  right: Falcon24AuthorityBinding,
): boolean {
  return (
    left.authority_epoch === right.authority_epoch &&
    left.baseline_id === right.baseline_id &&
    left.baseline_hash === right.baseline_hash &&
    left.activation_attempt_id === right.activation_attempt_id
  );
}

function mastraRunId(runId: string): string {
  return `root-loop:${runId}`;
}

function initialLoopState(runId: string): RootLoopState {
  return rootLoopStateSchema.parse({
    schema_version: "root-agent-loop-state@1.0.0",
    runId: mastraRunId(runId),
    turn_index: 0,
    accepted_tool_observations: [],
    verifier_feedback: null,
    terminal: false,
    terminal_error_code: null,
  });
}

function restoreLoopState(input: Parameters<RunWorkflowExecutorPort["execute"]>[0]): RootLoopState {
  const snapshot = input.restored_snapshot;
  if (!snapshot) return initialLoopState(input.lease.run_id);
  const state = rootLoopStateSchema.safeParse(snapshot.mastra_snapshot);
  if (
    !state.success ||
    snapshot.run_id !== input.lease.run_id ||
    snapshot.attempt_id !== input.lease.attempt_id ||
    snapshot.worker_fence !== input.lease.worker_fence ||
    snapshot.workflow_id !== ROOT_LOOP_WORKFLOW_ID ||
    snapshot.workflow_definition_revision !== ROOT_LOOP_WORKFLOW_REVISION ||
    snapshot.mastra_run_id !== mastraRunId(input.lease.run_id) ||
    state.data.runId !== snapshot.mastra_run_id ||
    state.data.turn_index !== snapshot.snapshot_version ||
    state.data.turn_index > input.lease.execution_policy.max_root_turns ||
    state.data.accepted_tool_observations.some(
      ({ output_ref: outputRef }) =>
        outputRef !== null &&
        (outputRef.run_id !== input.lease.run_id ||
          outputRef.app_id !== input.lease.scope.app_id ||
          outputRef.tenant_id !== input.lease.scope.tenant_id ||
          outputRef.environment !== input.lease.scope.environment),
    )
  ) {
    throw new Error("ROOT_AGENT_LOOP_SNAPSHOT_INVALID");
  }
  return state.data;
}

function acceptedArtifactRefs(
  observations: readonly RootToolObservation[],
): readonly ArtifactReference[] {
  return observations.flatMap((observation) =>
    observation.status === "COMPLETED" ? [observation.output_ref] : [],
  );
}

function correlateContinuation(
  decision: RootAgentDecisionCandidate,
  observations: readonly RootToolObservation[],
  feedback: RootVerifierFeedback | null,
): boolean {
  if (decision.kind === "FINAL_ANSWER") {
    return observations.length === 0 && feedback !== null;
  }
  if (feedback !== null || observations.length !== decision.tool_calls.length) return false;
  return decision.tool_calls.every((call) => {
    const observation = observations.find(
      ({ tool_call_id: toolCallId }) => toolCallId === call.tool_call_id,
    );
    return observation?.profile_id === call.profile_id;
  });
}

async function checkpointLoop(
  input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
  state: RootLoopState,
): Promise<PortResult<unknown>> {
  const lastArtifact = acceptedArtifactRefs(state.accepted_tool_observations).at(-1) ?? null;
  return input.context.checkpoint({
    workflow_id: ROOT_LOOP_WORKFLOW_ID,
    workflow_definition_revision: ROOT_LOOP_WORKFLOW_REVISION,
    mastra_run_id: mastraRunId(input.lease.run_id),
    snapshot_version: state.turn_index,
    active_artifact_ref: lastArtifact,
    mastra_snapshot: state,
  });
}

export function createDataAgentTeamRunner(
  dependencies: DataAgentTeamRunnerDependencies,
): RunWorkflowExecutorPort {
  return Object.freeze({
    async execute(
      input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    ): Promise<RunExecutorResult> {
      if (!hasRunExecutionContextProvenance(input.context)) {
        return failed("RUN_EXECUTION_CONTEXT_NOT_TRUSTED");
      }
      const payload = effectiveConfigRunLeasePayloadSchema.safeParse(input.lease.payload);
      if (
        !payload.success ||
        payload.data.kind !== "START_DATA_AGENT_TEAM" ||
        input.lease.command_kind !== "START_DATA_AGENT_TEAM"
      ) {
        return failed("DATA_AGENT_TEAM_LEASE_INVALID");
      }
      if (
        payload.data.schema_version !== "effective-config-team-lease@3.0.0" ||
        payload.data.executor_version !== "ROOT_HARNESS@1"
      ) {
        return failed("ROOT_AGENT_LEASE_VERSION_UNSUPPORTED");
      }
      if (!dependencies.authority) {
        return failed("FALCON24_RUNTIME_AUTHORITY_NOT_CONFIGURED");
      }
      const currentAuthority = await dependencies.authority.loadCurrent();
      if (!currentAuthority.ok) return failed(currentAuthority.error.code);
      if (!currentAuthority.value) return failed("FALCON24_AUTHORITY_NOT_ACTIVE");
      const runAuthority = await dependencies.authority.loadRunBinding(input.lease.run_id);
      if (!runAuthority.ok) return failed(runAuthority.error.code);
      if (!sameAuthorityBinding(currentAuthority.value, runAuthority.value)) {
        return failed("FALCON24_RUNTIME_AUTHORITY_DRIFT");
      }
      if (runAuthority.value.schema_version !== "falcon24-authority-binding@2.0.0") {
        return failed("FALCON24_RUNTIME_AUTHORITY_VERSION_UNSUPPORTED");
      }
      if (!dependencies.catalog_authority) {
        return failed("ROOT_AGENT_CATALOG_AUTHORITY_NOT_CONFIGURED");
      }
      const frozenProfiles = await dependencies.catalog_authority.loadFrozen(
        payload.data.catalog_snapshot,
      );
      if (!frozenProfiles.ok) return failed(frozenProfiles.error.code);
      if (!dependencies.root) return failed("ROOT_AGENT_TURN_NOT_CONFIGURED");
      if (!dependencies.root_runtime) return failed("ROOT_AGENT_RUNTIME_NOT_CONFIGURED");

      let state: RootLoopState;
      try {
        state = restoreLoopState(input);
      } catch (error) {
        return failed(error instanceof Error ? error.message : "ROOT_AGENT_LOOP_SNAPSHOT_INVALID");
      }
      if (state.terminal) {
        return state.terminal_error_code
          ? failed(state.terminal_error_code)
          : runExecutorResultSchema.parse({ kind: "COMPLETED" });
      }

      for (
        let turnIndex = state.turn_index;
        turnIndex < input.lease.execution_policy.max_root_turns;
        turnIndex += 1
      ) {
        const decision = await dependencies.root.decide(input, {
          turn_index: turnIndex,
          tool_observations: state.accepted_tool_observations,
          verifier_feedback: state.verifier_feedback,
        });
        if (!decision.ok) return failed(decision.error.code);
        if (
          decision.value.kind === "TOOL_CALLS" &&
          decision.value.tool_calls.some((call) =>
            state.accepted_tool_observations.some(
              ({ tool_call_id: toolCallId }) => toolCallId === call.tool_call_id,
            ),
          )
        ) {
          return failed("ROOT_AGENT_TOOL_CALL_REPLAYED");
        }
        const runtime = rootRuntimeResultSchema.safeParse(
          await dependencies.root_runtime.execute({
            decision: decision.value,
            turn_index: turnIndex,
            accepted_artifact_refs: acceptedArtifactRefs(state.accepted_tool_observations),
            execution: input,
            profiles: frozenProfiles.value,
            authority: runAuthority.value,
          }),
        );
        if (!runtime.success) return failed("ROOT_AGENT_RUNTIME_RESULT_INVALID");
        if (runtime.data.status === "ACCEPTED") {
          if (decision.value.kind !== "FINAL_ANSWER") {
            return failed("ROOT_AGENT_RUNTIME_RESULT_INVALID");
          }
          state = rootLoopStateSchema.parse({
            ...state,
            turn_index: turnIndex + 1,
            verifier_feedback: null,
            terminal: true,
            terminal_error_code: null,
          });
          const checkpoint = await checkpointLoop(input, state);
          return checkpoint.ok
            ? runExecutorResultSchema.parse({ kind: "COMPLETED" })
            : failed(checkpoint.error.code);
        }
        if (runtime.data.status !== "CONTINUE") {
          state = rootLoopStateSchema.parse({
            ...state,
            turn_index: turnIndex + 1,
            terminal: true,
            terminal_error_code: runtime.data.reason_code,
          });
          const checkpoint = await checkpointLoop(input, state);
          return checkpoint.ok ? failed(runtime.data.reason_code) : failed(checkpoint.error.code);
        }
        if (
          !correlateContinuation(
            decision.value,
            runtime.data.observations,
            runtime.data.verifier_feedback,
          )
        ) {
          return failed("ROOT_AGENT_RUNTIME_RESULT_INVALID");
        }
        const nextObservations = [...state.accepted_tool_observations];
        for (const observation of runtime.data.observations) {
          const existing = nextObservations.find(
            ({ tool_call_id: toolCallId }) => toolCallId === observation.tool_call_id,
          );
          if (existing && canonicalizeJson(existing) !== canonicalizeJson(observation)) {
            return failed("ROOT_TOOL_OBSERVATION_REPLAY_MISMATCH");
          }
          if (!existing) nextObservations.push(observation);
        }
        const exhausted = turnIndex + 1 >= input.lease.execution_policy.max_root_turns;
        state = rootLoopStateSchema.parse({
          ...state,
          turn_index: turnIndex + 1,
          accepted_tool_observations: nextObservations,
          verifier_feedback: runtime.data.verifier_feedback,
          terminal: exhausted,
          terminal_error_code: exhausted ? "ROOT_AGENT_TURN_BUDGET_EXHAUSTED" : null,
        });
        const checkpoint = await checkpointLoop(input, state);
        if (!checkpoint.ok) return failed(checkpoint.error.code);
        if (exhausted) return failed("ROOT_AGENT_TURN_BUDGET_EXHAUSTED");
      }
      return failed("ROOT_AGENT_TURN_BUDGET_EXHAUSTED");
    },
  });
}

export const dataAgentTeamRunnerInternals = Object.freeze({
  sameAuthorityBinding,
  ROOT_LOOP_WORKFLOW_ID,
  ROOT_LOOP_WORKFLOW_REVISION,
  restoreLoopState,
});
