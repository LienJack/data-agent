import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFalcon24AcceptanceRunManifest,
  canonicalizeJson,
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  type Falcon24AgentAnalysisRunResult,
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
  artifactType:
    | "AnalysisProgram"
    | "SensitiveExecutionArtifact"
    | "SandboxExecutionReceipt"
    | "ArtifactWorkspaceDocument",
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
    const manifest = await buildFalcon24AcceptanceRunManifest({
      schema_version: "falcon24-analysis-run-manifest@2.0.0" as const,
      campaign_id: "falcon24-root-v13-final",
      campaign_version: 13,
      source_fingerprint: hash("e"),
      frozen_contract_hash: hash("f"),
      runtime_attestation_hash: hash("d"),
      runs: manifestRuns,
    });
    await writeFile(manifestPath, JSON.stringify(manifest));
    const testCase = FALCON24_AGENT_ANALYSIS_CASES[0];
    const metadata = manifestRuns[0];
    if (!testCase || !metadata) throw new TypeError("acceptance fixture missing");
    const oracleMaterial = {
      schema_version: "falcon24-analysis-oracle@4.0.0" as const,
      oracle_kind: "ARROW_INPUT_RECOMPUTE" as const,
      case_id: testCase.case_id,
      verdict: "PASS" as const,
      input_hash: hash("1"),
      input_materialization_receipt_hash: hash("2"),
      query_evidence_hash: hash("3"),
      output_hash: hash("4"),
      chart_dataset_hash: hash("6"),
      verification_hash: hash("5"),
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      operator_receipt_closure_hash: hash("7"),
      operator_receipts: testCase.required_operator_calls.map(
        ({ call_id: callId, operator_id: operatorId }) => ({
          schema_version: "statistical-operator-call-receipt@1.0.0" as const,
          call_id: callId,
          operator_id: operatorId,
          operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
          implementation_digest: hash("8"),
          resolved_parameters: {},
          resolved_parameters_hash: hash("9"),
          input_hash: hash("a"),
          output_hash: hash("b"),
          result_binding_hash: hash("c"),
          sample_size: 1,
          group_count: 1,
          family_size: null,
          rank: null,
          applicability: "PASS" as const,
          limitation_codes: [],
        }),
      ),
      method_receipts: testCase.required_methods.map((methodId) => ({
        method_id: methodId,
        status: "PASS" as const,
        evidence_hash: hash("5"),
        operator_call_ids: testCase.required_operator_calls.map(({ call_id: callId }) => callId),
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
      generated_python_refs: [
        reference("SensitiveExecutionArtifact", metadata.run_id, 7),
        reference("SensitiveExecutionArtifact", metadata.run_id, 12),
      ],
      sandbox_receipt_refs: [reference("SandboxExecutionReceipt", metadata.run_id, 8)],
      provider_invocation_refs: [
        { resource_id: id(9), resource_revision: 1, resource_hash: hash("9") },
        { resource_id: id(13), resource_revision: 1, resource_hash: hash("d") },
        { resource_id: id(14), resource_revision: 1, resource_hash: hash("e") },
      ],
      oracle_receipts: [oracleReceipt],
    } as unknown as AnalysisExecutionResult;
    let stagedResult: Falcon24AgentAnalysisRunResult | null = null;
    const recorder = createFalcon24AnalysisAcceptanceRecorder({
      manifest_path: manifestPath,
      async stage_result({ campaign_id: campaignId, result }) {
        expect(campaignId).toBe("falcon24-root-v13-final");
        if (stagedResult && canonicalizeJson(stagedResult) !== canonicalizeJson(result)) {
          throw new TypeError("FALCON24_ANALYSIS_RUN_RESULT_REPLAY_MISMATCH");
        }
        stagedResult = result;
      },
    });
    const input = {
      test_case: testCase,
      semantic_context_ref: {
        package_id: id(10),
        package_revision: 1 as const,
        package_hash: hash("a"),
      },
      execution,
      chart_ref: reference("ArtifactWorkspaceDocument", metadata.run_id, 11),
      completed_at: "2026-08-24T12:00:00.000Z",
    };

    await recorder.record(input);
    await recorder.record(input);

    const parsedResult = falcon24AgentAnalysisRunResultSchema.parse(stagedResult);
    expect(parsedResult).toMatchObject({
      case_id: testCase.case_id,
      run_variant: "COLD",
      repetition: 1,
      answer_hash: oracleReceipt.output_hash,
      chart_dataset_hash: oracleReceipt.chart_dataset_hash,
      model_generated_node_count: 1,
    });
    expect(parsedResult.generated_python_refs).toHaveLength(2);
    expect(parsedResult.provider_invocation_refs).toHaveLength(3);

    const changedOracleMaterial = {
      ...oracleMaterial,
      operator_receipt_closure_hash: hash("d"),
    };
    const changedOracleReceipt = falcon24AnalysisOracleReceiptSchema.parse({
      ...changedOracleMaterial,
      receipt_hash: await sha256ContentHash(changedOracleMaterial),
    });
    await expect(
      recorder.record({
        ...input,
        execution: {
          ...execution,
          oracle_receipts: [changedOracleReceipt],
        } as unknown as AnalysisExecutionResult,
      }),
    ).rejects.toThrow("FALCON24_ANALYSIS_RUN_RESULT_REPLAY_MISMATCH");
  });

  it("has no filesystem result fallback and requires only the frozen manifest", () => {
    const stage = async () => {};
    expect(createEnvironmentFalcon24AnalysisAcceptanceRecorder({}, stage)).toBeNull();
    expect(
      createEnvironmentFalcon24AnalysisAcceptanceRecorder(
        { FALCON24_ANALYSIS_RUN_MANIFEST: "manifest.json" },
        stage,
      ),
    ).not.toBeNull();
  });
});
