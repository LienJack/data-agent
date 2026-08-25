import { STATISTICAL_OPERATOR_REGISTRY_DIGEST, sha256ContentHash } from "@data-agent/contracts";
import {
  buildFalcon24AgentAnalysisGate,
  type Falcon24AgentAnalysisCase,
  falcon24AgentAnalysisRunResultSchema,
} from "@data-agent/contracts/evals";
import { describe, expect, it } from "vitest";
import {
  buildFalcon24AgentAnalysisAcceptanceSuite,
  FALCON24_SEMANTIC_RELEASE_BLUEPRINT,
} from "../src/test-center/falcon24-agent-analysis-suite.js";

const id = (suffix: number) => `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const completedAt = "2026-08-24T00:00:00.000Z";

function artifact(
  artifact_type:
    | "AnalysisProgram"
    | "SandboxExecutionReceipt"
    | "SensitiveExecutionArtifact"
    | "ArtifactWorkspaceDocument",
  runId: string,
  suffix: number,
) {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: hash((suffix % 10).toString()),
  } as const;
}

function operatorReceipts(testCase: Pick<Falcon24AgentAnalysisCase, "required_operator_calls">) {
  return testCase.required_operator_calls.map(({ call_id: callId, operator_id: operatorId }) => ({
    schema_version: "statistical-operator-call-receipt@1.0.0" as const,
    call_id: callId,
    operator_id: operatorId,
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    implementation_digest: hash("d"),
    resolved_parameters: {},
    resolved_parameters_hash: hash("e"),
    input_hash: hash("f"),
    output_hash: hash("1"),
    result_binding_hash: hash("2"),
    sample_size: 1,
    group_count: 1,
    family_size: null,
    rank: null,
    applicability: "PASS" as const,
    limitation_codes: [],
  }));
}

describe("Falcon24 agent analysis acceptance", () => {
  it("publishes the exact nine-table, seventy-column semantic blueprint and five cases", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    expect(suite.model_id).toBe("deepseek-v4-flash");
    expect(suite.execution_surface).toBe("AGENT");
    expect(suite.cases).toHaveLength(5);
    expect(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.tables).toHaveLength(9);
    expect(
      FALCON24_SEMANTIC_RELEASE_BLUEPRINT.tables.reduce(
        (count, table) => count + table.columns.length,
        0,
      ),
    ).toBe(70);
    expect(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.relationships).toHaveLength(8);
    expect(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas.inventory_damage_rate).toBe(
      "SUM(damaged_stock)/NULLIF(SUM(stock_received),0)",
    );
    expect(suite.cases.at(-1)).toMatchObject({
      expected_terminal: "HOLD_WITH_SENSITIVITY",
      required_quality_findings: expect.arrayContaining(["ORDER_BEFORE_REGISTRATION"]),
    });
  });

  it("opens only after five cases pass three cold and three warm runs with generated Python", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    let runSuffix = 100;
    const results = await Promise.all(
      suite.cases.flatMap((testCase, caseIndex) =>
        (["COLD", "WARM"] as const).flatMap((runVariant) =>
          [1, 2, 3].map(async (repetition) => {
            runSuffix += 1;
            const runId = id(runSuffix);
            const verificationHash = hash(((caseIndex + 6) % 10).toString());
            const operatorCallIds = testCase.required_operator_calls.map(
              ({ call_id: callId }) => callId,
            );
            const oracleMaterial = {
              schema_version: "falcon24-analysis-oracle@4.0.0" as const,
              oracle_kind: "ARROW_INPUT_RECOMPUTE" as const,
              case_id: testCase.case_id,
              verdict: "PASS" as const,
              input_hash: hash("a"),
              input_materialization_receipt_hash: hash("b"),
              query_evidence_hash: hash("c"),
              output_hash: hash((caseIndex + 1).toString()),
              chart_dataset_hash: hash((caseIndex + 2).toString()),
              verification_hash: verificationHash,
              operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
              operator_receipt_closure_hash: hash("4"),
              operator_receipts: operatorReceipts(testCase),
              method_receipts: testCase.required_methods.map((methodId) => ({
                method_id: methodId,
                status: "PASS" as const,
                evidence_hash: verificationHash,
                operator_call_ids: operatorCallIds,
              })),
              disclosures: testCase.required_disclosures,
              quality_findings: testCase.required_quality_findings,
              terminal: testCase.expected_terminal,
            };
            return falcon24AgentAnalysisRunResultSchema.parse({
              schema_version: "falcon24-agent-analysis-run@4.0.0",
              case_id: testCase.case_id,
              run_id: runId,
              run_variant: runVariant,
              repetition,
              provider: "deepseek",
              model_id: "deepseek-v4-flash",
              model_override_attempted: false,
              provider_invocation_refs: [
                {
                  resource_id: id(40 + caseIndex),
                  resource_revision: 1,
                  resource_hash: hash("9"),
                },
              ],
              semantic_context_ref: {
                package_id: id(10 + caseIndex),
                package_revision: 1,
                package_hash: hash((caseIndex + 1).toString()),
              },
              analysis_program_ref: artifact("AnalysisProgram", runId, 20 + caseIndex),
              generated_python_refs: [
                artifact("SensitiveExecutionArtifact", runId, 30 + caseIndex),
              ],
              sandbox_receipt_refs: [artifact("SandboxExecutionReceipt", runId, 50 + caseIndex)],
              model_generated_node_count: 1,
              oracle_receipt: {
                ...oracleMaterial,
                receipt_hash: await sha256ContentHash(oracleMaterial),
              },
              sandbox_status: "SUCCEEDED",
              answer_hash: hash((caseIndex + 1).toString()),
              chart_ref: artifact("ArtifactWorkspaceDocument", runId, 60 + caseIndex),
              chart_dataset_hash: hash((caseIndex + 2).toString()),
              completed_at: completedAt,
            });
          }),
        ),
      ),
    );
    await expect(
      buildFalcon24AgentAnalysisGate({
        gate_id: id(999),
        suite,
        results,
        completed_at: completedAt,
      }),
    ).resolves.toMatchObject({
      result: "GO",
      case_count: 5,
      generated_python_case_count: 5,
      operator_closed_case_count: 5,
      charted_case_count: 5,
      run_count: 30,
      operator_closed_run_count: 30,
      charted_run_count: 30,
      flake_count: 0,
    });

    const flaky = results.map((result, index) =>
      index === 0 ? { ...result, answer_hash: hash("f") } : result,
    );
    await expect(
      buildFalcon24AgentAnalysisGate({
        gate_id: id(998),
        suite,
        results: flaky,
        completed_at: completedAt,
      }),
    ).rejects.toThrow("FALCON24_ANALYSIS_RESULT_FLAKE");

    const chartFlaky = await Promise.all(
      results.map(async (result, index) => {
        if (index !== 0) return result;
        const { receipt_hash: _receiptHash, ...receiptMaterial } = result.oracle_receipt;
        const changedReceiptMaterial = { ...receiptMaterial, chart_dataset_hash: hash("f") };
        return {
          ...result,
          chart_dataset_hash: hash("f"),
          oracle_receipt: {
            ...changedReceiptMaterial,
            receipt_hash: await sha256ContentHash(changedReceiptMaterial),
          },
        };
      }),
    );
    await expect(
      buildFalcon24AgentAnalysisGate({
        gate_id: id(997),
        suite,
        results: chartFlaky,
        completed_at: completedAt,
      }),
    ).rejects.toThrow("FALCON24_ANALYSIS_CHART_FLAKE");

    const operatorFlaky = await Promise.all(
      results.map(async (result, index) => {
        if (index !== 0) return result;
        const { receipt_hash: _receiptHash, ...receiptMaterial } = result.oracle_receipt;
        const changedReceiptMaterial = {
          ...receiptMaterial,
          operator_receipt_closure_hash: hash("e"),
        };
        return {
          ...result,
          oracle_receipt: {
            ...changedReceiptMaterial,
            receipt_hash: await sha256ContentHash(changedReceiptMaterial),
          },
        };
      }),
    );
    await expect(
      buildFalcon24AgentAnalysisGate({
        gate_id: id(995),
        suite,
        results: operatorFlaky,
        completed_at: completedAt,
      }),
    ).rejects.toThrow("FALCON24_ANALYSIS_OPERATOR_FLAKE");

    const operatorTampered = await Promise.all(
      results.map(async (result, index) => {
        if (index !== 0) return result;
        const { receipt_hash: _receiptHash, ...receiptMaterial } = result.oracle_receipt;
        const firstReceipt = receiptMaterial.operator_receipts[0];
        if (!firstReceipt) throw new TypeError("operator receipt fixture missing");
        const changedReceiptMaterial = {
          ...receiptMaterial,
          operator_receipts: [
            { ...firstReceipt, operator_id: "multiple-testing.bh-fdr@1" as const },
            ...receiptMaterial.operator_receipts.slice(1),
          ],
        };
        return {
          ...result,
          oracle_receipt: {
            ...changedReceiptMaterial,
            receipt_hash: await sha256ContentHash(changedReceiptMaterial),
          },
        };
      }),
    );
    await expect(
      buildFalcon24AgentAnalysisGate({
        gate_id: id(996),
        suite,
        results: operatorTampered,
        completed_at: completedAt,
      }),
    ).rejects.toThrow("FALCON24_ANALYSIS_ORACLE_BINDING_INVALID");

    const registryTampered = await Promise.all(
      results.map(async (result, index) => {
        if (index !== 0) return result;
        const { receipt_hash: _receiptHash, ...receiptMaterial } = result.oracle_receipt;
        const operatorRegistryDigest = hash("0");
        const changedReceiptMaterial = {
          ...receiptMaterial,
          operator_registry_digest: operatorRegistryDigest,
          operator_receipts: receiptMaterial.operator_receipts.map((operatorReceipt) => ({
            ...operatorReceipt,
            operator_registry_digest: operatorRegistryDigest,
          })),
        };
        return {
          ...result,
          oracle_receipt: {
            ...changedReceiptMaterial,
            receipt_hash: await sha256ContentHash(changedReceiptMaterial),
          },
        };
      }),
    );
    await expect(
      buildFalcon24AgentAnalysisGate({
        gate_id: id(994),
        suite,
        results: registryTampered,
        completed_at: completedAt,
      }),
    ).rejects.toThrow("FALCON24_ANALYSIS_ORACLE_BINDING_INVALID");
  });

  it("rejects model override or missing generated Python before gate evaluation", () => {
    const base = {
      schema_version: "falcon24-agent-analysis-run@4.0.0",
      case_id: "falcon24-business-review-18m",
      run_id: id(500),
      run_variant: "COLD",
      repetition: 1,
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      model_override_attempted: false,
      provider_invocation_ref: {
        resource_id: id(504),
        resource_revision: 1,
        resource_hash: hash("5"),
      },
      semantic_context_ref: {
        package_id: id(501),
        package_revision: 1,
        package_hash: hash("1"),
      },
      analysis_program_ref: artifact("AnalysisProgram", id(500), 502),
      generated_python_refs: [artifact("SensitiveExecutionArtifact", id(500), 503)],
      sandbox_receipt_refs: [artifact("SandboxExecutionReceipt", id(500), 505)],
      model_generated_node_count: 1,
      oracle_receipt: {
        schema_version: "falcon24-analysis-oracle@4.0.0",
        oracle_kind: "ARROW_INPUT_RECOMPUTE",
        case_id: "falcon24-business-review-18m",
        verdict: "PASS",
        input_hash: hash("a"),
        input_materialization_receipt_hash: hash("b"),
        query_evidence_hash: hash("c"),
        output_hash: hash("3"),
        chart_dataset_hash: hash("6"),
        verification_hash: hash("2"),
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        operator_receipt_closure_hash: hash("4"),
        operator_receipts: operatorReceipts({
          required_operator_calls: [
            {
              call_id: "q1_revenue_identity",
              operator_id: "decomposition.product-shapley-exact@1",
            },
          ],
        }),
        method_receipts: [
          {
            method_id: "full-month-window",
            status: "PASS",
            evidence_hash: hash("2"),
            operator_call_ids: ["q1_revenue_identity"],
          },
        ],
        disclosures: [],
        quality_findings: [],
        terminal: "PASS",
        receipt_hash: hash("4"),
      },
      sandbox_status: "SUCCEEDED",
      answer_hash: hash("3"),
      chart_ref: artifact("ArtifactWorkspaceDocument", id(500), 506),
      chart_dataset_hash: hash("6"),
      completed_at: completedAt,
    } as const;
    expect(
      falcon24AgentAnalysisRunResultSchema.safeParse({
        ...base,
        model_override_attempted: true,
      }).success,
    ).toBe(false);
    expect(
      falcon24AgentAnalysisRunResultSchema.safeParse({
        ...base,
        generated_python_refs: [],
        model_generated_node_count: 0,
      }).success,
    ).toBe(false);
    expect(
      falcon24AgentAnalysisRunResultSchema.safeParse({
        ...base,
        oracle_receipt: {
          ...base.oracle_receipt,
          method_receipts: [
            ...base.oracle_receipt.method_receipts,
            ...base.oracle_receipt.method_receipts,
          ],
        },
      }).success,
    ).toBe(false);
  });
});
