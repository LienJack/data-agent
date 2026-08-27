import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import type { SemanticContextCommitResult } from "@data-agent/contracts/context";
import type {
  EffectiveRunConfigReceiptCandidate,
  Falcon24AuthorityBindingV2,
} from "@data-agent/contracts/runs";
import type { RunProviderDispatchCapability } from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";
import type { AnalysisFenceGuard } from "./analysis-agent-sandbox-executor.js";

/** Evaluation-facing port for governed Python analysis; it is not an intent router. */
export interface GovernedAgentAnalysisPort {
  analyze(input: {
    readonly lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"];
    readonly authority: Falcon24AuthorityBindingV2;
    readonly task_id: string;
    readonly max_context_bytes: number;
    readonly accepted_query_evidence_ref: ArtifactReference & {
      readonly artifact_type: "QueryEvidence";
    };
    readonly question: string;
    readonly semantic_context: SemanticContextCommitResult;
    readonly effective_config: EffectiveRunConfigReceiptCandidate;
    readonly provider_dispatch: RunProviderDispatchCapability;
    readonly fence_guard: AnalysisFenceGuard;
  }): Promise<{
    readonly answer: string;
    readonly public_artifact_refs: readonly ArtifactReference[];
    readonly accepted_artifact_refs: readonly ArtifactReference[];
  }>;
}
