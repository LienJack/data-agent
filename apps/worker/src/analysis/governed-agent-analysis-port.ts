import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import type { SemanticContextCommitResult } from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import type { AnalysisFenceGuard } from "./analysis-agent-sandbox-executor.js";
import type { RunProviderDispatchCapability } from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";

/** Evaluation-facing port for governed Python analysis; it is not an intent router. */
export interface GovernedAgentAnalysisPort {
  analyze(input: {
    readonly lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"];
    readonly test_case: Falcon24AgentAnalysisCase;
    readonly question: string;
    readonly semantic_context: SemanticContextCommitResult;
    readonly provider_dispatch: RunProviderDispatchCapability;
    readonly fence_guard: AnalysisFenceGuard;
  }): Promise<{
    readonly answer: string;
    readonly public_artifact_refs: readonly ArtifactReference[];
    readonly accepted_artifact_refs: readonly ArtifactReference[];
  }>;
}
