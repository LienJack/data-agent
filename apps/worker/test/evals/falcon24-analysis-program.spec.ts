import { type ArtifactReference, buildAnalysisContext } from "@data-agent/contracts";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { describe, expect, it } from "vitest";
import {
  createFalcon24AnalysisProgram,
  falcon24AnalysisProgramInternals,
} from "../../src/evals/falcon24-analysis-program.js";

const id = (suffix: number) => `50000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  suffix: number,
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: hash((suffix % 10).toString()),
  };
}

describe("Falcon24 analysis program compiler", () => {
  it("compiles every acceptance question to one package-bound model-generated Python node", async () => {
    const semanticReleaseRef = reference("SemanticRelease", 10);
    const dimensionIds = [
      "customer_segment",
      "delivery_status",
      "marketing_channel",
      "order_month",
      "payment_method",
      "product_category",
      "registration_cohort",
      "target_audience",
    ];
    const context = await buildAnalysisContext({
      schema_version: "analysis-context@2.0.0",
      scope,
      semantic_context_binding: {
        package_id: id(11),
        package_hash: hash("a"),
        receipt_id: id(12),
        receipt_hash: hash("b"),
      },
      semantic_release_ref: semanticReleaseRef,
      schema_snapshot_ref: reference("SchemaSnapshot", 13),
      policy_receipt_ref: reference("PolicyReceipt", 14),
      semantic_retrieval_receipt_hash: hash("b"),
      semantic_inference_receipt_hash: hash("c"),
      metrics: [
        {
          metric_ref: { container_ref: semanticReleaseRef, node_id: "order_revenue" },
          formula_hash: hash("d"),
          unit: null,
          grain: { grain_id: "order-month", granularity: "month" },
          time_domain: {
            time_domain_id: "falcon24-order-time",
            calendar: "gregorian",
            timezone: "Asia/Shanghai",
            min_time: "2023-05-01T00:00:00.000Z",
            max_time: "2024-11-04T00:00:00.000Z",
          },
          time_dimension_ref: "order_date",
          additivity: "additive",
          null_policy: "exclude",
          missing_period_policy: "REJECT_GAP",
          seasonality: { kind: "MONTHLY", period_count: 12, minimum_history_points: 18 },
          priority: 10_000,
          causal_role: "OUTCOME",
          allowed_dimensions: dimensionIds.map((dimensionId) => ({
            dimension_id: dimensionId,
            grain: { grain_id: "order-month", granularity: "month" },
            data_type: "text",
            sensitivity: "INTERNAL",
            groupable: true,
            pivotable: true,
            causal_role: "CANDIDATE_CONFOUNDER",
          })),
          analysis_capabilities: ["CHART_DATASET"],
        },
      ],
      relationships: [],
      causal_policy: null,
    });
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    const programs = await Promise.all(
      suite.cases.map((testCase) =>
        createFalcon24AnalysisProgram({
          test_case: testCase,
          brief_ref: reference("ResearchBrief", 16),
          context,
          metric_ids: ["order_revenue"],
        }),
      ),
    );
    expect(programs).toHaveLength(5);
    expect(
      programs[1]?.nodes[0]?.result_contract.result_fields.find(
        ({ field }) => field === "conclusion",
      ),
    ).toMatchObject({
      data_type: "STRING",
      text_constraints: {
        required_substrings: ["关联"],
        forbidden_substrings: ["导致", "证明", "驱动"],
        required_suffix: "该证据仅支持统计关联，不支持因果判断。",
      },
    });
    expect(
      falcon24AnalysisProgramInternals.method_contracts["falcon24-business-review-18m"],
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("minimum signed month-over-month revenue change"),
        expect.stringContaining("clip every item-row quantity"),
        expect.stringContaining("exactly the keys active_buyers, orders_per_buyer"),
        expect.stringContaining("Never invent parallel scalar variables"),
      ]),
    );
    for (const [index, program] of programs.entries()) {
      const testCase = suite.cases[index];
      if (!testCase) throw new Error("missing Falcon24 case");
      expect(program.nodes[0]?.result_contract.result_fields.map(({ field }) => field)).toEqual([
        "schema_version",
        "case_id",
        ...falcon24AnalysisProgramInternals.result_contracts[testCase.case_id].required_fields,
      ]);
    }
    expect(
      programs.every(
        (program) =>
          program.semantic_context_package_hash === context.semantic_context_binding.package_hash &&
          program.nodes.length === 1 &&
          program.nodes[0]?.execution_mode === "MODEL_GENERATED" &&
          program.nodes[0]?.generated_source_policy === "GOVERNED_OPERATOR_ORCHESTRATION" &&
          (program.nodes[0]?.operator_obligations.length ?? 0) > 0 &&
          program.nodes[0]?.skill_id === "open-python-analysis@1",
      ),
    ).toBe(true);
    expect(programs.map((program) => program.nodes[0]?.time_window.start)).toEqual([
      "2023-05-01T00:00:00.000Z",
      "2023-11-01T00:00:00.000Z",
      "2023-11-01T00:00:00.000Z",
      "2023-05-01T00:00:00.000Z",
      "2023-05-01T00:00:00.000Z",
    ]);
    expect(
      falcon24AnalysisProgramInternals.method_contracts["falcon24-inventory-damage-12m"].join(" "),
    ).toContain("do not round");
    expect(
      falcon24AnalysisProgramInternals.method_contracts["falcon24-inventory-damage-12m"].join(" "),
    ).toContain("result bh_q_value to table adjusted_p_value");
    expect(
      falcon24AnalysisProgramInternals.method_contracts["falcon24-inventory-damage-12m"].join(" "),
    ).toContain("inventory_rows");
    expect(programs[2]?.nodes[0]?.result_contract.collection_constraints).toEqual([
      expect.objectContaining({ collection_field: "products", min_items: 1 }),
    ]);
    expect(programs[2]?.nodes[0]?.result_contract.tables[0]?.projection).toMatchObject({
      mode: "RESULT_COLLECTION",
      collection_field: "products",
    });
    expect(
      falcon24AnalysisProgramInternals.method_contracts["falcon24-marketing-lag-effect"].join(" "),
    ).toContain("q4_marketing_priority's fdr_tests evidence");
    expect(
      falcon24AnalysisProgramInternals.presentation_contracts[
        "falcon24-cohort-retention-m0-m6"
      ].columns.find(({ key }) => key === "average_spend")?.nullable,
    ).toBe(true);
    expect(
      falcon24AnalysisProgramInternals.method_contracts["falcon24-cohort-retention-m0-m6"].join(
        " ",
      ),
    ).toContain("cohort_count=12");
    expect(
      programs.map((program) =>
        program.nodes[0]?.operator_obligations.map(({ operator_id: operatorId }) => operatorId),
      ),
    ).toEqual([
      ["decomposition.product-shapley-exact@1"],
      ["regression.binomial-logit-wald@1"],
      [
        "robust-trend.theil-sen-slope@1",
        "trend.mann-kendall-original@1",
        "multiple-testing.bh-fdr@1",
        "descriptive.inventory-damage-priority@1",
      ],
      [
        "regression.ols-hac@1",
        "descriptive.marketing-lag-priority@1",
      ],
      ["cohort.registration-retention-m0-m6@2", "cohort.registration-retention-m0-m6@2"],
    ]);
    expect(
      Object.values(falcon24AnalysisProgramInternals.method_contracts).flat().join(" "),
    ).not.toMatch(
      /(?:all 66 slopes|math\.erf|statsmodels|1-based rank|Newey-West HAC covariance)/u,
    );
  });
});
