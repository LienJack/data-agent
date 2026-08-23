import { sha256ContentHash } from "@data-agent/contracts";
import {
  buildFalcon24AgentAnalysisGate,
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
  artifact_type: "AnalysisProgram" | "SandboxExecutionReceipt" | "SensitiveExecutionArtifact",
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
    expect(FALCON24_SEMANTIC_RELEASE_BLUEPRINT.formulas.inventory_damage_rate).toContain(
      "damaged_stock+stock_received",
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
            const oracleMaterial = {
              schema_version: "falcon24-analysis-oracle@1.0.0" as const,
              case_id: testCase.case_id,
              verdict: "PASS" as const,
              output_hash: hash((caseIndex + 1).toString()),
              method_receipts: testCase.required_methods.map((methodId, methodIndex) => ({
                method_id: methodId,
                status: "PASS" as const,
                evidence_hash: hash(((methodIndex + 1) % 10).toString()),
              })),
              disclosures: testCase.required_disclosures,
              quality_findings: testCase.required_quality_findings,
              terminal: testCase.expected_terminal,
            };
            return falcon24AgentAnalysisRunResultSchema.parse({
              schema_version: "falcon24-agent-analysis-run@1.0.0",
              case_id: testCase.case_id,
              run_id: runId,
              run_variant: runVariant,
              repetition,
              provider: "deepseek",
              model_id: "deepseek-v4-flash",
              model_override_attempted: false,
              provider_invocation_ref: {
                resource_id: id(40 + caseIndex),
                resource_revision: 1,
                resource_hash: hash("9"),
              },
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
      run_count: 30,
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
  });

  it("rejects model override or missing generated Python before gate evaluation", () => {
    const base = {
      schema_version: "falcon24-agent-analysis-run@1.0.0",
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
        schema_version: "falcon24-analysis-oracle@1.0.0",
        case_id: "falcon24-business-review-18m",
        verdict: "PASS",
        output_hash: hash("3"),
        method_receipts: [
          { method_id: "full-month-window", status: "PASS", evidence_hash: hash("2") },
        ],
        disclosures: [],
        quality_findings: [],
        terminal: "PASS",
        receipt_hash: hash("4"),
      },
      sandbox_status: "SUCCEEDED",
      answer_hash: hash("3"),
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
  });
});
