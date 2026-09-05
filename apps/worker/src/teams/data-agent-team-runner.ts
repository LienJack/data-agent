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
  type RootAcceptedInputArtifact,
  type RootAgentDecisionCandidate,
  type RootToolObservation,
  type RootVerifierFeedback,
  rootAcceptedInputArtifactSchema,
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
import {
  buildTerminalRootEvidenceDecision,
  type RootAgentTurnPort,
} from "./root-agent-turn-executor.js";

const reasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);

// Local type rejection or a fully observed rejected response may consume a normal
// turn. Unknown provider outcomes and all other protocol failures remain terminal.
const ROOT_RECOVERABLE_TURN_FEEDBACK_CODES = new Set([
  "ROOT_AGENT_PROVIDED_UNSUPPORTED_INPUT_ARTIFACT",
  "ROOT_AGENT_REQUESTED_UNSUPPORTED_OUTPUT_ARTIFACT",
  "PROVIDER_RESPONSE_REJECTED",
]);

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
const LEGACY_ROOT_LOOP_WORKFLOW_REVISION = `sha256:${createHash("sha256")
  .update("data-agent/root-agent-tool-loop@1.0.0")
  .digest("hex")}`;
const ROOT_LOOP_WORKFLOW_REVISION = `sha256:${createHash("sha256")
  .update("data-agent/root-agent-tool-loop@2.0.0")
  .digest("hex")}`;

const rootLoopStateSchema = z
  .strictObject({
    schema_version: z.literal("root-agent-loop-state@2.0.0"),
    runId: z.string().min(1).max(128),
    turn_index: z.number().int().nonnegative().max(4),
    checkpoint_version: z.number().int().nonnegative().max(8),
    accepted_input_artifacts: z.array(rootAcceptedInputArtifactSchema).max(16),
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

const legacyRootLoopStateSchema = z.strictObject({
  schema_version: z.literal("root-agent-loop-state@1.0.0"),
  runId: z.string().min(1).max(128),
  turn_index: z.number().int().nonnegative().max(4),
  accepted_tool_observations: z.array(rootAgentToolResultSchema).max(32),
  verifier_feedback: rootVerifierFeedbackSchema.nullable(),
  terminal: z.boolean(),
  terminal_error_code: reasonCodeSchema.nullable(),
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
  readonly accepted_inputs?: {
    load(
      input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    ): Promise<PortResult<readonly RootAcceptedInputArtifact[]>>;
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
    schema_version: "root-agent-loop-state@2.0.0",
    runId: mastraRunId(runId),
    turn_index: 0,
    checkpoint_version: 0,
    accepted_input_artifacts: [],
    accepted_tool_observations: [],
    verifier_feedback: null,
    terminal: false,
    terminal_error_code: null,
  });
}

function restoreLoopState(input: Parameters<RunWorkflowExecutorPort["execute"]>[0]): RootLoopState {
  const snapshot = input.restored_snapshot;
  if (!snapshot) return initialLoopState(input.lease.run_id);
  const currentState = rootLoopStateSchema.safeParse(snapshot.mastra_snapshot);
  const legacyState = legacyRootLoopStateSchema.safeParse(snapshot.mastra_snapshot);
  const isCurrent =
    currentState.success && snapshot.workflow_definition_revision === ROOT_LOOP_WORKFLOW_REVISION;
  const isLegacy =
    legacyState.success &&
    snapshot.workflow_definition_revision === LEGACY_ROOT_LOOP_WORKFLOW_REVISION;
  const state = isCurrent
    ? currentState
    : isLegacy
      ? rootLoopStateSchema.safeParse({
          ...legacyState.data,
          schema_version: "root-agent-loop-state@2.0.0",
          checkpoint_version: legacyState.data.turn_index,
          accepted_input_artifacts: [],
        })
      : currentState;
  // Snapshot provenance belongs to the writer; takeover creates a new attempt and higher fence.
  const validLeaseOrigin =
    snapshot.worker_fence === input.lease.worker_fence
      ? snapshot.attempt_id === input.lease.attempt_id
      : snapshot.worker_fence < input.lease.worker_fence &&
        snapshot.attempt_id !== input.lease.attempt_id;
  if (
    !state.success ||
    snapshot.run_id !== input.lease.run_id ||
    !validLeaseOrigin ||
    snapshot.workflow_id !== ROOT_LOOP_WORKFLOW_ID ||
    (!isCurrent && !isLegacy) ||
    snapshot.mastra_run_id !== mastraRunId(input.lease.run_id) ||
    state.data.runId !== snapshot.mastra_run_id ||
    state.data.checkpoint_version !== snapshot.snapshot_version ||
    state.data.turn_index > input.lease.execution_policy.max_root_turns ||
    state.data.accepted_input_artifacts.some(
      ({ artifact_ref: artifactRef }) =>
        artifactRef.run_id !== input.lease.run_id ||
        artifactRef.app_id !== input.lease.scope.app_id ||
        artifactRef.tenant_id !== input.lease.scope.tenant_id ||
        artifactRef.environment !== input.lease.scope.environment,
    ) ||
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
  inputs: readonly RootAcceptedInputArtifact[],
  observations: readonly RootToolObservation[],
): readonly ArtifactReference[] {
  return [
    ...inputs.map(({ artifact_ref: artifactRef }) => artifactRef),
    ...observations.flatMap((observation) =>
      observation.status === "COMPLETED" ? [observation.output_ref] : [],
    ),
  ];
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
  const lastArtifact =
    acceptedArtifactRefs(state.accepted_input_artifacts, state.accepted_tool_observations).at(-1) ??
    null;
  return input.context.checkpoint({
    workflow_id: ROOT_LOOP_WORKFLOW_ID,
    workflow_definition_revision: ROOT_LOOP_WORKFLOW_REVISION,
    mastra_run_id: mastraRunId(input.lease.run_id),
    snapshot_version: state.checkpoint_version,
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

      if (
        state.turn_index === 0 &&
        input.restored_snapshot === null &&
        dependencies.accepted_inputs
      ) {
        const loadedInputs = await dependencies.accepted_inputs.load(input);
        if (!loadedInputs.ok) return failed(loadedInputs.error.code);
        const parsedInputs = z
          .array(rootAcceptedInputArtifactSchema)
          .max(16)
          .safeParse(loadedInputs.value);
        if (!parsedInputs.success) return failed("ROOT_ACCEPTED_INPUT_INVALID");
        if (parsedInputs.data.length > 0) {
          state = rootLoopStateSchema.parse({
            ...state,
            checkpoint_version: state.checkpoint_version + 1,
            accepted_input_artifacts: parsedInputs.data,
          });
          const checkpoint = await checkpointLoop(input, state);
          if (!checkpoint.ok) return failed(checkpoint.error.code);
        }
      }

      for (
        let turnIndex = state.turn_index;
        turnIndex < input.lease.execution_policy.max_root_turns;
        turnIndex += 1
      ) {
        const decision = await dependencies.root.decide(input, {
          turn_index: turnIndex,
          accepted_input_artifacts: state.accepted_input_artifacts,
          tool_observations: state.accepted_tool_observations,
          verifier_feedback: state.verifier_feedback,
        });
        if (!decision.ok) {
          if (!ROOT_RECOVERABLE_TURN_FEEDBACK_CODES.has(decision.error.code)) {
            return failed(decision.error.code);
          }
          const exhausted = turnIndex + 1 >= input.lease.execution_policy.max_root_turns;
          state = rootLoopStateSchema.parse({
            ...state,
            turn_index: turnIndex + 1,
            checkpoint_version: state.checkpoint_version + 1,
            verifier_feedback: {
              schema_version: "root-verifier-feedback@1.0.0",
              status: "REJECTED",
              reason_code: decision.error.code,
            },
            terminal: exhausted,
            terminal_error_code: exhausted ? "ROOT_AGENT_TURN_BUDGET_EXHAUSTED" : null,
          });
          const checkpoint = await checkpointLoop(input, state);
          if (!checkpoint.ok) return failed(checkpoint.error.code);
          if (exhausted) return failed("ROOT_AGENT_TURN_BUDGET_EXHAUSTED");
          continue;
        }
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
            accepted_artifact_refs: acceptedArtifactRefs(
              state.accepted_input_artifacts,
              state.accepted_tool_observations,
            ),
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
            checkpoint_version: state.checkpoint_version + 1,
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
            checkpoint_version: state.checkpoint_version + 1,
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
        const canSettleFinalEvidence =
          exhausted &&
          decision.value.kind === "TOOL_CALLS" &&
          (await buildTerminalRootEvidenceDecision({
            scope: input.lease.scope,
            run_id: input.lease.run_id,
            catalog_snapshot_hash: payload.data.catalog_snapshot.snapshot_hash,
            observations: nextObservations,
          })) !== null;
        const budgetFailed = exhausted && !canSettleFinalEvidence;
        state = rootLoopStateSchema.parse({
          ...state,
          turn_index: turnIndex + 1,
          checkpoint_version: state.checkpoint_version + 1,
          accepted_tool_observations: nextObservations,
          verifier_feedback: runtime.data.verifier_feedback,
          terminal: budgetFailed,
          terminal_error_code: budgetFailed ? "ROOT_AGENT_TURN_BUDGET_EXHAUSTED" : null,
        });
        const checkpoint = await checkpointLoop(input, state);
        if (!checkpoint.ok) return failed(checkpoint.error.code);
        if (budgetFailed) return failed("ROOT_AGENT_TURN_BUDGET_EXHAUSTED");
      }
      // Settle already accepted final evidence without a fifth Root/model/tool turn.
      // The active checkpoint above also enters here after an interrupted settlement.
      const terminalDecision = await buildTerminalRootEvidenceDecision({
        scope: input.lease.scope,
        run_id: input.lease.run_id,
        catalog_snapshot_hash: payload.data.catalog_snapshot.snapshot_hash,
        observations: state.accepted_tool_observations,
      });
      if (terminalDecision?.kind !== "FINAL_ANSWER") {
        return failed("ROOT_AGENT_TURN_BUDGET_EXHAUSTED");
      }
      const settlement = rootRuntimeResultSchema.safeParse(
        await dependencies.root_runtime.execute({
          decision: terminalDecision,
          turn_index: state.turn_index - 1,
          accepted_artifact_refs: acceptedArtifactRefs(
            state.accepted_input_artifacts,
            state.accepted_tool_observations,
          ),
          execution: input,
          profiles: frozenProfiles.value,
          authority: runAuthority.value,
        }),
      );
      const terminalError = !settlement.success
        ? "ROOT_AGENT_RUNTIME_RESULT_INVALID"
        : settlement.data.status === "ACCEPTED"
          ? null
          : settlement.data.status === "CONTINUE"
            ? (settlement.data.verifier_feedback?.reason_code ?? settlement.data.reason_code)
            : settlement.data.reason_code;
      state = rootLoopStateSchema.parse({
        ...state,
        checkpoint_version: state.checkpoint_version + 1,
        terminal: true,
        terminal_error_code: terminalError,
        verifier_feedback:
          settlement.success && settlement.data.status === "CONTINUE"
            ? settlement.data.verifier_feedback
            : null,
      });
      const checkpoint = await checkpointLoop(input, state);
      if (!checkpoint.ok) return failed(checkpoint.error.code);
      return terminalError
        ? failed(terminalError)
        : runExecutorResultSchema.parse({ kind: "COMPLETED" });
    },
  });
}

export const dataAgentTeamRunnerInternals = Object.freeze({
  sameAuthorityBinding,
  ROOT_LOOP_WORKFLOW_ID,
  ROOT_LOOP_WORKFLOW_REVISION,
  restoreLoopState,
});
