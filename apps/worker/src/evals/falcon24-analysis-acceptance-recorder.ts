import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import {
  type Falcon24AgentAnalysisCase,
  type Falcon24AgentAnalysisRunResult,
  falcon24AgentAnalysisRunResultSchema,
  falcon24AnalysisOracleReceiptSchema,
} from "@data-agent/contracts/evals";
import { z } from "zod";
import type { AnalysisExecutionResult } from "../analysis/executor.js";

const manifestEntrySchema = z.strictObject({
  run_id: z.uuid(),
  case_id: z.string().min(1),
  run_variant: z.enum(["COLD", "WARM"]),
  repetition: z.number().int().min(1).max(3),
});

const manifestSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-analysis-run-manifest@1.0.0"),
    runs: z.array(manifestEntrySchema).min(1).max(30),
  })
  .superRefine((manifest, context) => {
    const runIds = new Set(manifest.runs.map(({ run_id: runId }) => runId));
    const slots = new Set(
      manifest.runs.map(
        ({ case_id: caseId, run_variant: variant, repetition }) =>
          `${caseId}\0${variant}\0${repetition}`,
      ),
    );
    if (runIds.size !== manifest.runs.length || slots.size !== manifest.runs.length) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 run manifest identities must be unique.",
      });
    }
  });

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
  }): Promise<void>;
}

function single<T>(values: readonly T[], code: string): T {
  if (values.length !== 1 || values[0] === undefined) throw new TypeError(code);
  return values[0];
}

export function createFalcon24AnalysisAcceptanceRecorder(input: {
  readonly manifest_path: string;
  readonly results_path: string;
}): Falcon24AnalysisAcceptanceRecorder {
  let writeQueue: Promise<void> = Promise.resolve();
  const append = async (
    recordInput: Parameters<Falcon24AnalysisAcceptanceRecorder["record"]>[0],
  ) => {
    const manifest = manifestSchema.parse(JSON.parse(await readFile(input.manifest_path, "utf8")));
    const runId = recordInput.execution.analysis_program_ref.run_id;
    const metadata = manifest.runs.find(({ run_id: candidate }) => candidate === runId);
    if (!metadata || metadata.case_id !== recordInput.test_case.case_id) {
      throw new TypeError("FALCON24_ANALYSIS_RUN_MANIFEST_MISMATCH");
    }
    const providerInvocation = single(
      recordInput.execution.provider_invocation_refs,
      "FALCON24_ANALYSIS_PROVIDER_INVOCATION_REF_REQUIRED",
    );
    const generatedPython = single(
      recordInput.execution.generated_python_refs,
      "FALCON24_ANALYSIS_GENERATED_PYTHON_REF_REQUIRED",
    );
    const sandboxReceipt = single(
      recordInput.execution.sandbox_receipt_refs,
      "FALCON24_ANALYSIS_SANDBOX_RECEIPT_REF_REQUIRED",
    );
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
      provider_invocation_ref: providerInvocation,
      semantic_context_ref: recordInput.semantic_context_ref,
      analysis_program_ref: recordInput.execution.analysis_program_ref,
      generated_python_refs: [generatedPython],
      sandbox_receipt_refs: [sandboxReceipt],
      model_generated_node_count: 1,
      oracle_receipt: oracleReceipt,
      sandbox_status: "SUCCEEDED",
      answer_hash: oracleReceipt.output_hash,
      chart_ref: recordInput.chart_ref,
      chart_dataset_hash: oracleReceipt.chart_dataset_hash,
      completed_at: recordInput.completed_at,
    });
    const current = await readFile(input.results_path, "utf8")
      .then((value) =>
        z.array(falcon24AgentAnalysisRunResultSchema).max(30).parse(JSON.parse(value)),
      )
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return [] satisfies Falcon24AgentAnalysisRunResult[];
        }
        throw error;
      });
    const existing = current.find(({ run_id: existingRunId }) => existingRunId === runId);
    if (existing) {
      const { completed_at: _existingCompletedAt, ...existingReplay } = existing;
      const { completed_at: _resultCompletedAt, ...resultReplay } = result;
      if (canonicalizeJson(existingReplay) !== canonicalizeJson(resultReplay)) {
        throw new TypeError("FALCON24_ANALYSIS_RUN_RESULT_REPLAY_MISMATCH");
      }
      return;
    }
    const next = [...current, result].sort(
      (left, right) =>
        left.case_id.localeCompare(right.case_id) ||
        left.run_variant.localeCompare(right.run_variant) ||
        left.repetition - right.repetition,
    );
    await mkdir(dirname(input.results_path), { recursive: true });
    const temporaryPath = `${input.results_path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporaryPath, input.results_path);
  };
  return Object.freeze({
    record(recordInput: Parameters<Falcon24AnalysisAcceptanceRecorder["record"]>[0]) {
      const next = writeQueue.then(() => append(recordInput));
      writeQueue = next.catch(() => undefined);
      return next;
    },
  });
}

export function createEnvironmentFalcon24AnalysisAcceptanceRecorder(
  environment: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): Falcon24AnalysisAcceptanceRecorder | null {
  const manifestPath = environment.FALCON24_ANALYSIS_RUN_MANIFEST?.trim();
  const resultsPath = environment.FALCON24_ANALYSIS_RESULTS?.trim();
  if (!manifestPath && !resultsPath) return null;
  if (!manifestPath || !resultsPath) {
    throw new TypeError("FALCON24_ANALYSIS_ACCEPTANCE_RECORDER_CONFIG_INCOMPLETE");
  }
  return createFalcon24AnalysisAcceptanceRecorder({
    manifest_path: resolve(cwd, manifestPath),
    results_path: resolve(cwd, resultsPath),
  });
}
