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
      ],
      [
        "regression.ols-hac@1",
        "multiple-testing.bh-fdr@1",
        "multiple-testing.bh-fdr@1",
        "multiple-testing.bh-fdr@1",
      ],
      ["cohort.registration-retention-m0-m6@1", "cohort.registration-retention-m0-m6@1"],
    ]);
    expect(
      Object.values(falcon24AnalysisProgramInternals.method_contracts).flat().join(" "),
    ).not.toMatch(
      /(?:all 66 slopes|math\.erf|statsmodels|1-based rank|Newey-West HAC covariance)/u,
    );
  });
});
