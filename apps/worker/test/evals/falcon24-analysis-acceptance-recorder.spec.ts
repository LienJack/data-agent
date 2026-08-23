import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  falcon24AgentAnalysisRunResultSchema,
  falcon24AnalysisOracleReceiptSchema,
} from "@data-agent/contracts/evals";
import { FALCON24_AGENT_ANALYSIS_CASES } from "@data-agent/evals";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisExecutionResult } from "../../src/analysis/executor.js";
import {
  createEnvironmentFalcon24AnalysisAcceptanceRecorder,
  createFalcon24AnalysisAcceptanceRecorder,
} from "../../src/evals/falcon24-analysis-acceptance-recorder.js";

const id = (suffix: number) => `37000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const temporaryDirectories: string[] = [];

function reference(
  artifactType: "AnalysisProgram" | "SensitiveExecutionArtifact" | "SandboxExecutionReceipt",
  runId: string,
  suffix: number,
) {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  } as const;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Falcon24 analysis acceptance recorder", () => {
  it("writes one strict, idempotent Agent run result from runtime evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "falcon24-recorder-"));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, "manifest.json");
    const resultsPath = join(directory, "actual-runs.json");
    const manifestRuns = FALCON24_AGENT_ANALYSIS_CASES.flatMap((testCase, caseIndex) =>
      (["COLD", "WARM"] as const).flatMap((runVariant, variantIndex) =>
        [1, 2, 3].map((repetition) => ({
          run_id: id(100 + caseIndex * 10 + variantIndex * 3 + repetition),
          case_id: testCase.case_id,
          run_variant: runVariant,
          repetition,
        })),
      ),
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: "falcon24-analysis-run-manifest@1.0.0",
        runs: manifestRuns,
      }),
    );
    const testCase = FALCON24_AGENT_ANALYSIS_CASES[0];
    const metadata = manifestRuns[0];
    if (!testCase || !metadata) throw new TypeError("acceptance fixture missing");
    const oracleMaterial = {
      schema_version: "falcon24-analysis-oracle@2.0.0" as const,
      oracle_kind: "ARROW_INPUT_RECOMPUTE" as const,
      case_id: testCase.case_id,
      verdict: "PASS" as const,
      input_hash: hash("1"),
      input_materialization_receipt_hash: hash("2"),
      query_evidence_hash: hash("3"),
      output_hash: hash("4"),
      verification_hash: hash("5"),
      method_receipts: testCase.required_methods.map((methodId) => ({
        method_id: methodId,
        status: "PASS" as const,
        evidence_hash: hash("5"),
      })),
      disclosures: [...testCase.required_disclosures],
      quality_findings: [...testCase.required_quality_findings],
      terminal: testCase.expected_terminal,
    };
    const oracleReceipt = falcon24AnalysisOracleReceiptSchema.parse({
      ...oracleMaterial,
      receipt_hash: await sha256ContentHash(oracleMaterial),
    });
    const analysisProgramRef = reference("AnalysisProgram", metadata.run_id, 6);
    const execution = {
      analysis_program_ref: analysisProgramRef,
      generated_python_refs: [reference("SensitiveExecutionArtifact", metadata.run_id, 7)],
      sandbox_receipt_refs: [reference("SandboxExecutionReceipt", metadata.run_id, 8)],
      provider_invocation_refs: [
        { resource_id: id(9), resource_revision: 1, resource_hash: hash("9") },
      ],
      oracle_receipts: [oracleReceipt],
    } as unknown as AnalysisExecutionResult;
    const recorder = createFalcon24AnalysisAcceptanceRecorder({
      manifest_path: manifestPath,
      results_path: resultsPath,
    });
    const input = {
      test_case: testCase,
      semantic_context_ref: {
        package_id: id(10),
        package_revision: 1 as const,
        package_hash: hash("a"),
      },
      execution,
      completed_at: "2026-08-24T12:00:00.000Z",
    };

    await recorder.record(input);
    await recorder.record(input);

    const results = JSON.parse(await readFile(resultsPath, "utf8"));
    expect(results).toHaveLength(1);
    expect(falcon24AgentAnalysisRunResultSchema.parse(results[0])).toMatchObject({
      case_id: testCase.case_id,
      run_variant: "COLD",
      repetition: 1,
      answer_hash: oracleReceipt.output_hash,
      model_generated_node_count: 1,
    });
  });

  it("fails closed when only one recorder path is configured", () => {
    expect(() =>
      createEnvironmentFalcon24AnalysisAcceptanceRecorder({
        FALCON24_ANALYSIS_RESULTS: "actual-runs.json",
      }),
    ).toThrow("FALCON24_ANALYSIS_ACCEPTANCE_RECORDER_CONFIG_INCOMPLETE");
  });
});
