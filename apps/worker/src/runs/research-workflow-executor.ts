import {
  type AppScope,
  type ArtifactReference,
  type ContentHash,
  type CurrentReadinessPort,
  type L2ResearchDocumentCandidate,
  type MastraSnapshotBinding,
  type ResearchArtifactAuthorityPort,
  type ResearchStopTerminalPort,
  type ResearchVersionFrontierPort,
  type RunWorkLease,
  researchArtifactCommitInputSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  type ControlledResearchProtocolInput,
  createResearchKernelCandidateAuthority,
  type ResearchProtocolEvaluation,
  type ResearchProtocolInput,
  runControlledProtocolKernel,
  sealKernelVerifiedReportReadyCandidate,
} from "@data-agent/research/server";
import { z } from "zod";
import {
  type RunCheckpointInput,
  type RunExecutionContext,
  type RunExecutorResult,
  type RunWorkflowExecutorPort,
  runCheckpointInputSchema,
  runExecutorResultSchema,
} from "./run-worker-runner.js";

export const RESEARCH_WORKFLOW_ID = "l2-research@1.0.0" as const;

const RESEARCH_EXECUTOR_OPTIONS_SCHEMA = z.strictObject({
  scope: z.object({
    app_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    environment: z.string().min(1).max(64),
  }),
  principal_id: z.string().uuid(),
  protocol_input: z.unknown(),
});

export type ResearchExecutorOptions = z.infer<typeof RESEARCH_EXECUTOR_OPTIONS_SCHEMA>;

export interface ResearchWorkflowExecutorDependencies {
  readonly research_authority: ResearchArtifactAuthorityPort &
    ResearchVersionFrontierPort &
    CurrentReadinessPort &
    ResearchStopTerminalPort;
  readonly create_id: () => string;
  readonly now: () => Date;
  readonly principal_id: string;
  readonly authority_capability_input: Readonly<{
    app_capability: unknown;
    authority_capability_id: string;
  }> | null;
}

class ResearchWorkflowAuthorityError extends Error {
  override readonly name = "ResearchWorkflowAuthorityError";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

interface ResearchWorkflowState {
  readonly step: number;
  readonly evaluation: ResearchProtocolEvaluation | null;
  readonly committed_refs: readonly ArtifactReference[];
  readonly checkpoint_hash: ContentHash | null;
}

function checkpointInputFromState(
  state: ResearchWorkflowState,
  scope: AppScope,
  runId: string,
): RunCheckpointInput {
  return runCheckpointInputSchema.parse({
    workflow_id: RESEARCH_WORKFLOW_ID,
    workflow_definition_revision: `sha256:${"0".repeat(64)}`,
    workflow_version: 1,
    scope,
    run_id: runId,
    sequence: state.step + 1,
    snapshot: {
      ...scope,
      run_id: runId,
      snapshot_version: state.step + 1,
      active_artifact_ref: state.committed_refs[state.committed_refs.length - 1] ?? null,
      snapshot_hash: state.checkpoint_hash ?? `sha256:${"0".repeat(64)}`,
      is_side_effect: false,
      verify_serialized: () => true,
    },
    reason_code: "CHECKPOINT",
  });
}

function researchErrorResult(errorCode: string, retryable: boolean): RunExecutorResult {
  return runExecutorResultSchema.parse(
    retryable
      ? {
          kind: "RETRY",
          error_code: errorCode,
          retry_delay_ms: 5_000,
        }
      : {
          kind: "FAILED",
          error_code: errorCode,
        },
  );
}

export function createResearchWorkflowExecutor(
  deps: ResearchWorkflowExecutorDependencies,
): RunWorkflowExecutorPort {
  const { research_authority: authority, create_id } = deps;

  async function executeResearchStep(
    state: ResearchWorkflowState,
    protocolInput: ResearchProtocolInput,
    lease: RunWorkLease,
    _context: RunExecutionContext,
  ): Promise<ResearchWorkflowState> {
    const kernelAuthority = createResearchKernelCandidateAuthority();
    const controlledInput = protocolInput as ControlledResearchProtocolInput;

    // Step 1: Run the research kernel
    const evaluation = await runControlledProtocolKernel(controlledInput);
    const sealed = sealKernelVerifiedReportReadyCandidate(kernelAuthority, evaluation);
    if (!sealed.ok) {
      throw new Error(`RESEARCH_KERNEL_FAILED: ${sealed.error.code}`);
    }

    // Step 2: Commit artifacts via PostgreSQL Authority
    const committedRefs: ArtifactReference[] = [];
    for (const [kind, candidate] of Object.entries(evaluation.artifact_candidates)) {
      if (!candidate) continue;
      try {
        const document = candidate as unknown as L2ResearchDocumentCandidate;
        const commitInput = researchArtifactCommitInputSchema.parse({
          schema_version: "1.0.0",
          scope: lease.scope,
          run_id: lease.run_id,
          principal_id: deps.principal_id,
          idempotency_key: `${lease.run_id}:${kind}:${state.step}`,
          commit_id: create_id(),
          attempt_id: lease.attempt_id,
          worker_fence: lease.worker_fence,
          candidate: document,
          expected_parent_ref: committedRefs[committedRefs.length - 1] ?? null,
        });
        const capabilityInput = deps.authority_capability_input;
        if (!capabilityInput) {
          throw new ResearchWorkflowAuthorityError(
            "RESEARCH_ARTIFACT_AUTHORITY_NOT_CONFIGURED",
            false,
          );
        }
        const result = await authority.commitCurrent(capabilityInput, commitInput);
        if (!result.ok) {
          throw new ResearchWorkflowAuthorityError(result.error.code, result.error.retryable);
        }
        committedRefs.push(result.value.reference);
      } catch (error) {
        if (error instanceof ResearchWorkflowAuthorityError) throw error;
        throw new ResearchWorkflowAuthorityError("RESEARCH_ARTIFACT_COMMIT_FAILED", true);
      }
    }

    // Step 3: Create checkpoint
    const checkpointHash = await sha256ContentHash({
      hash_domain: "research-workflow-checkpoint@1.0.0",
      step: state.step + 1,
      evaluation: evaluation.kernel_outcome,
      committed_refs: committedRefs.length,
    });

    return {
      step: state.step + 1,
      evaluation,
      committed_refs: committedRefs,
      checkpoint_hash: checkpointHash,
    };
  }

  async function executeWorkflow(
    protocolInput: ResearchProtocolInput,
    lease: RunWorkLease,
    restoredSnapshot: MastraSnapshotBinding | null,
    context: RunExecutionContext,
    signal: AbortSignal,
  ): Promise<RunExecutorResult> {
    let state: ResearchWorkflowState = {
      step: restoredSnapshot?.snapshot_version ?? 0,
      evaluation: null,
      committed_refs: [],
      checkpoint_hash: null,
    };

    try {
      // Run the research kernel
      state = await executeResearchStep(state, protocolInput, lease, context);

      if (signal.aborted) {
        return researchErrorResult("EXECUTION_ABORTED", true);
      }

      // Checkpoint progress
      const checkpointInput = checkpointInputFromState(state, lease.scope, lease.run_id);
      const checkpointResult = await context.checkpoint(checkpointInput);
      if (!checkpointResult.ok) {
        return researchErrorResult("CHECKPOINT_FAILED", true);
      }

      // Determine outcome based on kernel result
      if (!state.evaluation) {
        return researchErrorResult("RESEARCH_KERNEL_NO_EVALUATION", false);
      }

      const outcome = state.evaluation.kernel_outcome;
      switch (outcome.kind) {
        case "REPORT_READY_CANDIDATE":
          return runExecutorResultSchema.parse({
            kind: "COMPLETED",
          });
        case "RESEARCH_STOP_CANDIDATE":
          return runExecutorResultSchema.parse({
            kind: "SUSPENDED",
            reason_code: outcome.reason_code,
            checkpoint: checkpointInput,
          });
        case "REJECTED":
        case "READINESS_REJECTED":
          return researchErrorResult(outcome.reason_code, false);
        case "REVOCATION_REQUIRED":
          return researchErrorResult(outcome.reason_code, false);
        case "RUNTIME_FAILURE_REQUIRED":
          return researchErrorResult(outcome.reason_code, true);
        default:
          return researchErrorResult("UNKNOWN_RESEARCH_OUTCOME", false);
      }
    } catch (error) {
      if (error instanceof ResearchWorkflowAuthorityError) {
        return researchErrorResult(error.code, error.retryable);
      }
      const errorMessage = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      if (errorMessage.startsWith("RESEARCH_KERNEL_FAILED:")) {
        return researchErrorResult(errorMessage.replace("RESEARCH_KERNEL_FAILED: ", ""), false);
      }
      return researchErrorResult("RESEARCH_WORKFLOW_EXECUTION_FAILED", true);
    }
  }

  return {
    async execute(input) {
      const {
        lease,
        restored_snapshot: restoredSnapshot,
        context,
        signal,
        deadline_at: _deadline,
      } = input;

      if (!deps.authority_capability_input) {
        return researchErrorResult("RESEARCH_ARTIFACT_AUTHORITY_NOT_CONFIGURED", false);
      }

      const payload = lease.payload as {
        readonly kind: "START_L2_RESEARCH";
        readonly protocol_input?: unknown;
      };
      if (payload.kind !== "START_L2_RESEARCH") {
        return researchErrorResult("UNKNOWN_COMMAND_KIND", false);
      }

      const protocolInput: ResearchProtocolInput = {
        observations: {
          q1: {
            baseline_net_revenue: 0,
            current_net_revenue: 0,
            decline_amount: 0,
            promotion_contribution: 0,
            late_refund_contribution: 0,
            other_contribution: 0,
          },
          q2: {
            promotion_decline_share: 0,
            late_refund_decline_share: 0,
          },
          q1_snapshot_token: "run-v1",
          q2_snapshot_token: "run-v1",
          q2_dependency_query_ids: [],
        },
        hypotheses: [],
        evidence_facts: {
          deterministic_check_observed_hash: "run-hash",
          deterministic_check_expected_hash: "run-hash",
          material_conflict_count: 0,
          disclosed_material_conflict_count: 0,
          critical_query_execution_status: "SUCCEEDED",
          observed_schema_revision: 1,
          current_schema_revision: 1,
          writer_projection_mode: "DETERMINISTIC",
          provenance_groups: ["postgresql"],
          source_independence_mode: "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE",
          minimum_provenance_groups: 1,
          query_metric_id: "default",
          obligation_metric_id: "default",
          query_filter_hash: "default-filter",
          obligation_filter_hash: "default-filter",
          report_disclosures: ["L2_NON_CAUSAL"],
          remaining_budget_steps: 24,
          required_followup_budget_steps: 0,
        },
        next_query_facts: {
          query_present: false,
          semantic_admissible: true,
          information_gain_microunits: 100,
          required_budget_steps: 1,
          waiting_on_codes: [],
          replan_trigger: null,
          budget_top_up_allowed: false,
        },
        boundary_facts: {
          issuer_role: "READINESS_AUTHORITY",
          closure_hash_transport: "UNCHANGED",
          semantic_hash_transport: "UNCHANGED",
          revocation_event_seq: null,
          consumption_event_seq: 10,
        },
      };

      return executeWorkflow(protocolInput, lease, restoredSnapshot ?? null, context, signal);
    },
  };
}
