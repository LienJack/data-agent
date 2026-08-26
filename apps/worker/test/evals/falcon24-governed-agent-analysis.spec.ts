import {
  type AnalysisContext,
  type ArtifactReference,
  buildAnalysisContext,
  DEFAULT_RUN_EXECUTION_POLICY,
  type RunWorkLease,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  computeFalcon24AnalysisChartDatasetHash,
  FALCON24_AGENT_ANALYSIS_CASES,
} from "@data-agent/evals";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisArtifactCommitPort } from "../../src/analysis/executor.js";
import {
  createFalcon24GovernedAgentAnalysisPort,
  falcon24GovernedAgentAnalysisInternals,
} from "../../src/evals/falcon24-governed-agent-analysis.js";

const id = (suffix: number) => `62000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const lease: RunWorkLease = {
  scope,
  principal_id: id(8),
  outbox_id: id(9),
  run_id: id(3),
  command_id: id(10),
  command_kind: "START_DATA_AGENT_TEAM",
  attempt_id: id(4),
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 300_000,
  worker_id: "falcon24-agent-analysis-test",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-24T00:05:00.000Z",
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
  payload: {},
};

function reference<T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  suffix: number,
): ArtifactReference & { readonly artifact_type: T } {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: lease.run_id,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  };
}

async function context(): Promise<AnalysisContext> {
  const semanticReleaseRef = reference("SemanticRelease", 20);
  const grain = { grain_id: "falcon24-analysis", granularity: "atomic" } as const;
  return buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope,
    semantic_context_binding: {
      package_id: id(21),
      package_hash: hash("a"),
      receipt_id: id(22),
      receipt_hash: hash("b"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: reference("SchemaSnapshot", 23),
    policy_receipt_ref: reference("PolicyReceipt", 24),
    semantic_retrieval_receipt_hash: hash("c"),
    semantic_inference_receipt_hash: hash("d"),
    metrics: [
      {
        metric_ref: { container_ref: semanticReleaseRef, node_id: "metric.order_revenue" },
        formula_hash: hash("e"),
        unit: null,
        grain,
        time_domain: {
          time_domain_id: "falcon24-complete-month-frontier",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: "2023-05-01T00:00:00.000Z",
          max_time: "2024-11-01T00:00:00.000Z",
        },
        time_dimension_ref: "order_date",
        additivity: "additive",
        null_policy: "exclude",
        missing_period_policy: "REJECT_GAP",
        seasonality: null,
        priority: 10_000,
        causal_role: "OUTCOME",
        allowed_dimensions: ["customer_segment", "order_month", "payment_method"].map(
          (dimensionId) => ({
            dimension_id: dimensionId,
            grain,
            data_type: "text",
            sensitivity: "INTERNAL",
            groupable: true,
            pivotable: true,
            causal_role: "CANDIDATE_CONFOUNDER",
          }),
        ),
        analysis_capabilities: ["CHART_DATASET", "CONTRIBUTION", "TREND_CHANGE"],
      },
    ],
    relationships: [],
    causal_policy: null,
  });
}

function businessOutput() {
  const months = Array.from({ length: 18 }, (_, index) => {
    const date = new Date(Date.UTC(2023, 4 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  return {
    schema_version: "falcon24-business-review-output@1.0.0",
    case_id: "falcon24-business-review-18m",
    window: { start: "2023-05-01", end_exclusive: "2024-11-01", period_count: 18, grain: "MONTH" },
    monthly_kpis: months.map((month) => ({
      month,
      revenue: 100,
      order_count: 10,
      average_order_value: 10,
      active_buyers: 5,
      orders_per_buyer: 2,
    })),
    worst_revenue_decline: { month: "2024-10", absolute_change: -10, percent_change: -0.1 },
    shapley_decomposition: {
      start_month: "2024-09",
      end_month: "2024-10",
      buyer_contribution: -4,
      frequency_contribution: -3,
      aov_contribution: -3,
      observed_revenue_change: -10,
      closure_error: 0,
    },
    segment_drivers: [
      { dimension: "customer_segment", member: "new", revenue_change: -4 },
      { dimension: "product_category", member: "grocery", revenue_change: -3 },
      { dimension: "payment_method", member: "cash", revenue_change: -3 },
    ],
    method_evidence: {},
    conclusion: "2024-10 收入下降，购买人数、频次和客单价均有影响。",
  };
}

describe("Falcon24 governed Agent analysis bridge", () => {
  it("consumes the full semantic commit, compiles one DeepSeek Python node, and projects only Oracle-validated output", async () => {
    const analysisContext = await context();
    const testCase = FALCON24_AGENT_ANALYSIS_CASES[0];
    const briefRef = reference("ResearchBrief", 30);
    const programRef = reference("AnalysisProgram", 31);
    const evidenceRef = reference("DerivedAnalysisEvidence", 32);
    const queryEvidenceRef = reference("QueryEvidence", 35);
    const outputRef = reference("SandboxResult", 33);
    const completionRef = reference("AnalysisCompletionReceipt", 34);
    const chartRef = reference("ArtifactWorkspaceDocument", 36);
    const reportRef = reference("AnalysisReport", 37);
    const commitL2 = vi.fn<AnalysisArtifactCommitPort["commitL2"]>(async (input) => {
      expect(input.payload.artifact_type).toBe("ResearchBrief");
      return briefRef;
    });
    const artifacts: AnalysisArtifactCommitPort = {
      commitL2,
      async commitSystem(input) {
        return input.reference;
      },
      async resolveCommitted() {
        return null;
      },
    };
    const execute = vi.fn(async (input) => {
      expect(input.brief_ref).toBe(briefRef);
      expect(input.context).toBe(analysisContext);
      expect(input.program.nodes).toHaveLength(1);
      expect(input.program.nodes[0]).toMatchObject({
        node_id: testCase.case_id,
        skill_id: "open-python-analysis@1",
        execution_mode: "MODEL_GENERATED",
      });
      const content = Buffer.from(
        JSON.stringify({
          schema_version: "analysis-published-result@1.0.0",
          data: businessOutput(),
        }),
        "utf8",
      );
      const outputHash = await sha256ContentHash(businessOutput());
      return {
        analysis_program_ref: programRef,
        completion_ref: completionRef,
        chart_refs: [chartRef],
        report_ref: reportRef,
        completion: { terminal: "READY" },
        evidence_refs: [evidenceRef],
        query_evidence_refs: [queryEvidenceRef],
        oracle_receipts: [
          {
            output_hash: outputHash,
            chart_dataset_hash: await computeFalcon24AnalysisChartDatasetHash(businessOutput()),
          },
        ],
        published_outputs: [
          {
            node_id: testCase.case_id,
            output: {
              artifact_name: "result",
              artifact_kind: "RESULT",
              media_type: "application/json",
              reference: outputRef,
              content_sha256: hash("3"),
              content,
              bytes: content.byteLength,
            },
          },
        ],
        explanations: [],
        sandbox_receipts: [
          {
            runtime_profile: "ML_DIAGNOSTIC",
            runtime: {
              agent_image: "agent-ml@sha256:test",
              operator_image: "operator@sha256:test",
            },
          },
        ],
      } as never;
    });
    const semanticCommit = {
      receipt: { receipt_id: id(40), receipt_hash: hash("b") },
      package: {
        package_id: id(21),
        package_hash: hash("a"),
        semantic_release: { datasource_id: id(50) },
      },
    } as never;
    const compileContext = vi.fn(async (input) => {
      expect(input.semantic_context).toBe(semanticCommit);
      return { context: analysisContext, metric_ids: ["metric.order_revenue"] as const };
    });
    const port = createFalcon24GovernedAgentAnalysisPort({
      artifacts,
      public_artifacts: {
        async commit(_capability, _lease, document) {
          return { ok: true as const, value: document.artifact_ref };
        },
        async commitDerivedAnalysisChart(_capability, _lease, document) {
          return { ok: true as const, value: document.document_ref };
        },
        async resolveCommitted() {
          return { ok: true as const, value: null };
        },
      },
      public_artifact_capability: {},
      create_executor: () => ({ execute }),
      compile_context: compileContext as never,
    });

    const result = await port.analyze({
      lease,
      task_id: id(41),
      max_context_bytes: 65_536,
      accepted_query_evidence_ref: queryEvidenceRef,
      test_case: testCase,
      question: testCase.question,
      semantic_context: semanticCommit,
      effective_config: {} as never,
      provider_dispatch: {} as never,
      fence_guard: { isCurrent: async () => true },
    });
    expect(result.public_artifact_refs[0]?.artifact_type).toBe("ArtifactWorkspaceDocument");
    expect(result).toEqual({
      answer: `最近18个完整月（2023-05至2024-10）中，收入下降最明显的是 2024-10：环比减少 10（-10%）。 Shapley 恒等式分解为购买人数 -4、购买频次 -3、客单价 -3；绝对影响最大的是购买人数。 主要下拉场景为客户类型 new（-4）、商品品类 grocery（-3）和支付方式 cash（-3）。\n\n[查看对应图表](${chartRef ? `artifact://${chartRef.artifact_id}?revision=1&hash=${encodeURIComponent(chartRef.content_hash)}` : ""})`,
      public_artifact_refs: [chartRef],
      accepted_artifact_refs: [
        briefRef,
        programRef,
        evidenceRef,
        outputRef,
        chartRef,
        completionRef,
        reportRef,
      ],
    });
    expect(commitL2).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("renders the decision-bearing fields for delivery, inventory, marketing, and cohort answers", () => {
    const buildAnswer = falcon24GovernedAgentAnalysisInternals.buildFalcon24AnalysisAnswer;
    const delivery = buildAnswer({
      case_id: "falcon24-delivery-experience-12m",
      six_vs_six: {
        first: { p50_minutes: 5, p90_minutes: 21.5, on_time_rate: 0.68, low_rating_rate: 0.2 },
        second: { p50_minutes: 5, p90_minutes: 21, on_time_rate: 0.67, low_rating_rate: 0.22 },
      },
      low_rating_scenarios: [
        {
          product_category: "Dairy",
          customer_segment: "Regular",
          delivery_status: "On Time",
          order_count: 59,
          low_rating_rate: 0.34,
        },
      ],
      adjusted_binomial_glm: [{ delayed_coefficient: -0.06, delayed_p_value: 0.51 }],
      data_quality_precheck: { invalid_delivery_orders: 932, valid_delivery_orders: 2_127 },
    } as never);
    expect(delivery).toContain("Dairy/Regular/On Time");
    expect(delivery).toContain("p=0.51");
    expect(delivery).toContain("932 单配送时长无效");

    const inventory = buildAnswer({
      case_id: "falcon24-inventory-damage-12m",
      products: [
        {
          product_id: "647462",
          product_name: "Lotion",
          category: "Personal Care",
          sales_quantity: 33,
          last3_damage_rate: 1.2,
          previous9_damage_rate: 0.5,
          theil_sen_slope: 0.01,
          bh_q_value: 0.96,
          status: "WATCHLIST",
        },
      ],
    } as never);
    expect(inventory).toContain("PRIORITY 为 0 个");
    expect(inventory).toContain("Lotion[647462]");
    expect(inventory).toContain("Personal Care（1个）");

    const marketing = buildAnswer({
      case_id: "falcon24-marketing-lag-effect",
      channel_audience_results: [
        {
          channel: "App",
          target_audience: "Premium",
          roas: 1.9,
          group_finding: "GROWTH_ASSOCIATION",
          business_outcomes: [
            {
              metric: "new_customers",
              selected_lag_weeks: 1,
              bh_q_value: 0.04,
              finding: "GROWTH_ASSOCIATION",
            },
          ],
        },
        {
          channel: "App",
          target_audience: "All",
          roas: 1.8,
          group_finding: "SPEND_WITHOUT_IMPROVEMENT",
          business_outcomes: [],
        },
      ],
    } as never);
    expect(marketing).toContain("App/Premium");
    expect(marketing).toContain("new_customers 滞后1周");
    expect(marketing).toContain("App/All");

    const cohort = buildAnswer({
      case_id: "falcon24-cohort-retention-m0-m6",
      cohorts: [
        {
          registration_month: "2023-05",
          customer_type: "Premium",
          month_index: 0,
          retention_rate: 0.8,
          pre_registration_event_count: 1_186,
          pre_registration_customer_count: 767,
          invalid_delivery_event_count: 931,
          valid_ordering_customer_count: 531,
          no_order_customer_count: 209,
        },
        {
          registration_month: "2024-04",
          customer_type: "Premium",
          month_index: 6,
          retention_rate: 0.2,
        },
      ],
      sensitivity_cohorts: [
        {
          registration_month: "2023-05",
          customer_type: "Premium",
          month_index: 0,
          retention_rate: 0.7,
        },
        {
          registration_month: "2024-04",
          customer_type: "Premium",
          month_index: 6,
          retention_rate: 0.2,
        },
      ],
    } as never);
    expect(cohort).toContain("主分析必须 HOLD");
    expect(cohort).toContain("1186 个订单早于注册");
    expect(cohort).toContain("当前不能可靠断言");
  });
});
