import type { AdmittedSubagentDelegation } from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  effectiveConfigRunLeasePayloadSchema,
  type RootAgentDecisionCandidate,
  type SemanticContextCommitResult,
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

const rootRuntimeResultSchema = z.strictObject({
  status: z.enum(["ACCEPTED", "FAILED", "NEEDS_CLARIFICATION"]),
  reason_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/u),
});

export interface DataAgentProductTeamRuntimePort {
  execute(input: {
    readonly lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"];
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
  }): Promise<unknown>;
}

export interface DataAgentTeamRunnerDependencies {
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
      if (
        payload.data.schema_version !== "effective-config-team-lease@3.0.0" ||
        payload.data.executor_version !== "ROOT_HARNESS@1"
      ) {
        return failed("ROOT_AGENT_LEASE_VERSION_UNSUPPORTED");
      }
      if (!dependencies.root) return failed("ROOT_AGENT_TURN_NOT_CONFIGURED");
      if (!dependencies.root_runtime) return failed("ROOT_AGENT_RUNTIME_NOT_CONFIGURED");

      const decision = await dependencies.root.decide(input);
      if (!decision.ok) return failed(decision.error.code);
      const runtime = rootRuntimeResultSchema.safeParse(
        await dependencies.root_runtime.execute({ decision: decision.value, execution: input }),
      );
      if (!runtime.success) return failed("ROOT_AGENT_RUNTIME_RESULT_INVALID");
      if (runtime.data.status !== "ACCEPTED") return failed(runtime.data.reason_code);
      return runExecutorResultSchema.parse({ kind: "COMPLETED" });
    },
  });
}
