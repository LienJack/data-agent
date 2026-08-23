import type { AdmittedSubagentDelegation } from "@data-agent/agent-runtime";
import {
  type AgentDispatchPlan,
  type AgentProductProfileReference,
  type AgentProductProfileRegistryItem,
  effectiveConfigRunLeasePayloadSchema,
  type PortResult,
  type RootAgentDecisionCandidate,
} from "@data-agent/contracts";
import { hasRunExecutionContextProvenance } from "../runs/run-execution-context.js";
import {
  type RunExecutionContext,
  type RunExecutorResult,
  type RunWorkflowExecutorPort,
  runExecutorResultSchema,
} from "../runs/run-worker-runner.js";
import type { RootAgentTurnPort } from "./root-agent-turn-executor.js";

/** @deprecated Kept as a source-compatible type for the retired team runtime. */
export interface DataAgentProductTeamRuntimePort {
  execute(input: {
    readonly lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"];
    readonly profiles: ReadonlyMap<
      AgentProductProfileReference["profile_id"],
      AgentProductProfileRegistryItem
    >;
    readonly dispatch_plan?: AgentDispatchPlan | null;
    readonly admitted_delegations?: readonly AdmittedSubagentDelegation[];
    readonly resolved_context_ref: Readonly<{
      package_id: string;
      package_hash: string;
      receipt_id: string;
      receipt_hash: string;
      semantic_domain: string;
      semantic_release_id: string;
      semantic_release_hash: string;
    }>;
    readonly restored_snapshot: Parameters<
      RunWorkflowExecutorPort["execute"]
    >[0]["restored_snapshot"];
    readonly execution_context: RunExecutionContext;
    readonly signal: AbortSignal;
    readonly deadline_at: string;
  }): Promise<unknown>;
}

/** All QUESTION_RUN leases now use one direct executor; no Root/Specialist hop. */
export interface DataAgentTeamRunnerDependencies {
  readonly direct_analysis?: RunWorkflowExecutorPort;
  /** @deprecated Retired Root/Specialist composition fields. */
  readonly profiles?: {
    listEnabled(
      capabilityInput: unknown,
    ): Promise<PortResult<readonly AgentProductProfileRegistryItem[]>>;
  };
  readonly profile_capability_input?: unknown;
  readonly runtime?: DataAgentProductTeamRuntimePort;
  readonly direct?: RunWorkflowExecutorPort;
  readonly root?: RootAgentTurnPort;
  readonly root_runtime?: {
    execute(input: {
      readonly decision: RootAgentDecisionCandidate;
      readonly execution: Parameters<RunWorkflowExecutorPort["execute"]>[0];
    }): Promise<unknown>;
  };
}

function failed(errorCode: string): RunExecutorResult {
  return runExecutorResultSchema.parse({ kind: "FAILED", error_code: errorCode });
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
      if (!dependencies.direct_analysis) return failed("DIRECT_QA_EXECUTOR_NOT_CONFIGURED");
      return dependencies.direct_analysis.execute(input);
    },
  });
}
