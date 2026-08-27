import type { AdmittedSubagentDelegation } from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  effectiveConfigRunLeasePayloadSchema,
  type Falcon24AuthorityBinding,
  type Falcon24AuthorityBindingV2,
  type PortResult,
  type RootAgentDecisionCandidate,
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
  }): Promise<unknown>;
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

      const decision = await dependencies.root.decide(input);
      if (!decision.ok) return failed(decision.error.code);
      const runtime = rootRuntimeResultSchema.safeParse(
        await dependencies.root_runtime.execute({
          decision: decision.value,
          execution: input,
          profiles: frozenProfiles.value,
          authority: runAuthority.value,
        }),
      );
      if (!runtime.success) return failed("ROOT_AGENT_RUNTIME_RESULT_INVALID");
      if (runtime.data.status !== "ACCEPTED") return failed(runtime.data.reason_code);
      return runExecutorResultSchema.parse({ kind: "COMPLETED" });
    },
  });
}

export const dataAgentTeamRunnerInternals = Object.freeze({ sameAuthorityBinding });
