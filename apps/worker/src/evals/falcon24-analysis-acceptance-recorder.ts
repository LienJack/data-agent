import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import {
  type Falcon24AgentAnalysisCase,
  type Falcon24AgentAnalysisRunResult,
  falcon24AgentAnalysisRunResultSchema,
  falcon24AnalysisOracleReceiptSchema,
} from "@data-agent/contracts/evals";
import type { RunExecutionPolicy } from "@data-agent/contracts/runs";
import type { AnalysisExecutionResult } from "../analysis/executor.js";

export interface Falcon24AnalysisAcceptanceRecorder {
  record(input: {
    readonly test_case: Falcon24AgentAnalysisCase;
    readonly semantic_context_ref: {
      readonly package_id: string;
      readonly package_revision: 1;
      readonly package_hash: `sha256:${string}`;
    };
    readonly execution: AnalysisExecutionResult;
    readonly chart_ref: ArtifactReference;
    readonly completed_at: string;
    readonly execution_policy: RunExecutionPolicy;
  }): Promise<void>;
}

function single<T>(values: readonly T[], code: string): T {
  if (values.length !== 1 || values[0] === undefined) throw new TypeError(code);
  return values[0];
}

export function createFalcon24AnalysisAcceptanceRecorder(input: {
  readonly stage_result: (input: {
    readonly campaign_id: string;
    readonly result: Falcon24AgentAnalysisRunResult;
  }) => Promise<void>;
}): Falcon24AnalysisAcceptanceRecorder {
  let writeQueue: Promise<void> = Promise.resolve();
  const append = async (
    recordInput: Parameters<Falcon24AnalysisAcceptanceRecorder["record"]>[0],
  ) => {
    const metadata = recordInput.execution_policy;
    if (metadata.mode === "DEFAULT") return;
    const runId = recordInput.execution.analysis_program_ref.run_id;
    if (
      metadata.campaign_id === null ||
      metadata.case_id !== recordInput.test_case.case_id ||
      metadata.run_variant === null ||
      metadata.repetition === null
    ) {
      throw new TypeError("FALCON24_ANALYSIS_RUN_EXECUTION_POLICY_MISMATCH");
    }
    if (recordInput.execution.provider_invocation_refs.length === 0) {
      throw new TypeError("FALCON24_ANALYSIS_PROVIDER_INVOCATION_REF_REQUIRED");
    }
    if (recordInput.execution.generated_python_refs.length === 0) {
      throw new TypeError("FALCON24_ANALYSIS_GENERATED_PYTHON_REF_REQUIRED");
    }
    if (recordInput.execution.sandbox_receipt_refs.length === 0) {
      throw new TypeError("FALCON24_ANALYSIS_SANDBOX_RECEIPT_REF_REQUIRED");
    }
    const oracleReceipt = falcon24AnalysisOracleReceiptSchema.parse(
      single(recordInput.execution.oracle_receipts, "FALCON24_ANALYSIS_ORACLE_RECEIPT_REQUIRED"),
    );
    const result = falcon24AgentAnalysisRunResultSchema.parse({
      schema_version: "falcon24-agent-analysis-run@4.0.0",
      case_id: recordInput.test_case.case_id,
      run_id: runId,
      run_variant: metadata.run_variant,
      repetition: metadata.repetition,
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      model_override_attempted: false,
      provider_invocation_refs: [...recordInput.execution.provider_invocation_refs],
      semantic_context_ref: recordInput.semantic_context_ref,
      analysis_program_ref: recordInput.execution.analysis_program_ref,
      generated_python_refs: [...recordInput.execution.generated_python_refs],
      sandbox_receipt_refs: [...recordInput.execution.sandbox_receipt_refs],
      model_generated_node_count: recordInput.execution.sandbox_receipt_refs.length,
      oracle_receipt: oracleReceipt,
      sandbox_status: "SUCCEEDED",
      answer_hash: oracleReceipt.output_hash,
      chart_ref: recordInput.chart_ref,
      chart_dataset_hash: oracleReceipt.chart_dataset_hash,
      completed_at: recordInput.completed_at,
    });
    await input.stage_result({ campaign_id: metadata.campaign_id, result });
  };
  return Object.freeze({
    record(recordInput: Parameters<Falcon24AnalysisAcceptanceRecorder["record"]>[0]) {
      const next = writeQueue.then(() => append(recordInput));
      writeQueue = next.catch(() => undefined);
      return next;
    },
  });
}
