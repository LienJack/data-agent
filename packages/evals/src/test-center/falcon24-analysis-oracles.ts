import {
  type ArtifactWorkspaceChartProjectionV3,
  artifactWorkspaceChartProjectionV3Schema,
  computeArtifactWorkspaceChartDatasetV3Hash,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type Falcon24AgentAnalysisCase,
  falcon24AnalysisCaseIdSchema,
} from "@data-agent/contracts/evals";
import { z } from "zod";

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const probability = finite.min(0).max(1);
const month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
const methodEvidence = z.record(z.string().min(1), z.unknown());
const fullMonthWindowSchema = z.strictObject({
  start: z.string().date(),
  end_exclusive: z.string().date(),
  period_count: z.number().int().positive(),
  grain: z.literal("MONTH"),
});

const businessReviewSchema = z.strictObject({
  schema_version: z.literal("falcon24-business-review-output@1.0.0"),
  case_id: z.literal("falcon24-business-review-18m"),
  window: fullMonthWindowSchema,
  monthly_kpis: z
    .array(
      z.strictObject({
        month,
        revenue: nonnegative,
        order_count: z.number().int().nonnegative(),
        average_order_value: nonnegative,
        active_buyers: z.number().int().nonnegative(),
        orders_per_buyer: nonnegative,
      }),
    )
    .length(18),
  worst_revenue_decline: z.strictObject({ month, absolute_change: finite, percent_change: finite }),
  shapley_decomposition: z.strictObject({
    start_month: month,
    end_month: month,
    buyer_contribution: finite,
    frequency_contribution: finite,
    aov_contribution: finite,
    observed_revenue_change: finite,
    closure_error: nonnegative,
  }),
  segment_drivers: z
    .array(
      z.strictObject({
        dimension: z.enum(["customer_segment", "product_category", "payment_method"]),
        member: z.string().min(1),
        revenue_change: finite,
      }),
    )
    .min(3),
  method_evidence: methodEvidence,
  conclusion: z.string().min(1),
});

const deliverySchema = z.strictObject({
  schema_version: z.literal("falcon24-delivery-output@2.0.0"),
  case_id: z.literal("falcon24-delivery-experience-12m"),
  window: fullMonthWindowSchema,
  data_quality_precheck: z.strictObject({
    invalid_delivery_orders: z.number().int().nonnegative(),
    valid_delivery_orders: z.number().int().nonnegative(),
  }),
  six_vs_six: z.strictObject({
    first: z.strictObject({
      p50_minutes: nonnegative,
      p90_minutes: nonnegative,
      on_time_rate: probability,
      low_rating_rate: probability,
    }),
    second: z.strictObject({
      p50_minutes: nonnegative,
      p90_minutes: nonnegative,
      on_time_rate: probability,
      low_rating_rate: probability,
    }),
  }),
  adjusted_binomial_glm: z
    .array(
      z.strictObject({
        label: z.literal("delivery_low_rating_adjusted"),
        delayed_coefficient: finite,
        delayed_p_value: probability,
        sample_size: z.number().int().positive(),
        controls: z.array(z.string()).length(4),
        finding: z.enum(["POSITIVE_SIGNIFICANT", "NEGATIVE_SIGNIFICANT", "NOT_SIGNIFICANT"]),
        rank: z.number().int().positive(),
        converged: z.literal(true),
        iterations: z.number().int().nonnegative(),
      }),
    )
    .length(1),
  low_rating_scenarios: z
    .array(
      z.strictObject({
        product_category: z.string().min(1),
        customer_segment: z.string().min(1),
        delivery_status: z.string().min(1),
        order_count: z.number().int().positive(),
        low_rating_rate: probability,
      }),
    )
    .min(1),
  method_evidence: methodEvidence,
  claim_strength: z.literal("ASSOCIATION_ONLY"),
  conclusion: z.string().min(1),
});

const inventorySchema = z.strictObject({
  schema_version: z.literal("falcon24-inventory-output@1.0.0"),
  case_id: z.literal("falcon24-inventory-damage-12m"),
  window: fullMonthWindowSchema,
  primary_source: z.literal("blinkit_inventory"),
  sensitivity_source: z.literal("blinkit_inventoryNew"),
  sensitivity_combined_with_primary: z.literal(false),
  products: z.array(
    z.strictObject({
      product_id: z.string().min(1),
      product_name: z.string().min(1),
      category: z.string().min(1),
      sales_quantity: nonnegative,
      category_sales_p75: nonnegative,
      theil_sen_slope: finite,
      last3_damage_rate: nonnegative,
      previous9_damage_rate: nonnegative,
      raw_p_value: probability,
      bh_q_value: probability,
      status: z.enum(["PRIORITY", "WATCHLIST"]),
      product_count: z.number().int().positive(),
      candidate_count: z.number().int().positive(),
      category_sales_percentile: z.literal(0.75),
      selection_rule: z.literal("SALES_GTE_P75_AND_SLOPE_GT_0_AND_LAST3_GT_PREVIOUS9"),
    }),
  ),
  method_evidence: methodEvidence,
  conclusion: z.string().min(1),
});

const marketingFindingSchema = z.enum([
  "GROWTH_ASSOCIATION",
  "SPEND_WITHOUT_IMPROVEMENT",
  "NO_CLEAR_ASSOCIATION",
]);

const marketingOutcomeIds = ["order_revenue", "new_customers", "order_count"] as const;

const marketingSchema = z.strictObject({
  schema_version: z.literal("falcon24-marketing-output@2.0.0"),
  case_id: z.literal("falcon24-marketing-lag-effect"),
  window: z.strictObject({
    start: z.string().date(),
    end_exclusive: z.string().date(),
    week_count: z.number().int().positive(),
    grain: z.literal("WEEK"),
  }),
  channel_audience_results: z
    .array(
      z.strictObject({
        channel: z.string().min(1),
        target_audience: z.string().min(1),
        impressions: nonnegative,
        clicks: nonnegative,
        conversions: nonnegative,
        spend: nonnegative,
        revenue_generated: nonnegative,
        click_through_rate: probability,
        conversion_rate: probability,
        roas: nonnegative,
        business_outcomes: z
          .array(
            z.strictObject({
              metric: z.enum(marketingOutcomeIds),
              selected_lag_weeks: z.number().int().min(0).max(4),
              lag_coefficient: finite,
              hac_p_value: probability,
              bh_q_value: probability,
              finding: marketingFindingSchema,
            }),
          )
          .length(3)
          .superRefine((outcomes, context) => {
            for (const [index, metric] of marketingOutcomeIds.entries()) {
              if (outcomes[index]?.metric !== metric) {
                context.addIssue({
                  code: "custom",
                  message: "Marketing business outcomes must use the canonical three-metric order.",
                  path: [index, "metric"],
                });
              }
            }
          }),
        group_finding: marketingFindingSchema,
      }),
    )
    .min(1),
  controls: z.array(z.string()).min(2),
  method_evidence: methodEvidence,
  claim_strength: z.literal("ASSOCIATION_ONLY"),
  conclusion: z.string().min(1),
});

const cohortPeriodSchema = z.strictObject({
  registration_month: month,
  customer_type: z.string().min(1),
  month_index: z.number().int().min(0).max(6),
  eligible_customers: z.number().int().nonnegative(),
  active_customers: z.number().int().nonnegative(),
  retention_rate: probability,
  repeat_customers: z.number().int().nonnegative(),
  repeat_purchase_rate: probability,
  order_count: z.number().int().nonnegative(),
  revenue: nonnegative,
  average_spend: nonnegative.nullable(),
  average_delivery_minutes: nonnegative.nullable(),
  average_rating: finite.min(1).max(5).nullable(),
  cohort_size: z.number().int().positive(),
  matured: z.literal(true),
  pre_registration_event_count: z.number().int().nonnegative(),
  pre_registration_customer_count: z.number().int().nonnegative(),
  valid_ordering_customer_count: z.number().int().nonnegative(),
  no_order_customer_count: z.number().int().nonnegative(),
  orphan_event_count: z.number().int().nonnegative(),
  invalid_delivery_event_count: z.number().int().nonnegative(),
  data_quality_status: z.string().min(1),
});

const cohortSchema = z.strictObject({
  schema_version: z.literal("falcon24-cohort-output@2.0.0"),
  case_id: z.literal("falcon24-cohort-retention-m0-m6"),
  primary_reliable: z.literal(false),
  cohorts: z.array(cohortPeriodSchema).length(336),
  sensitivity_cohorts: z.array(cohortPeriodSchema).length(336),
  method_evidence: methodEvidence,
  conclusion: z.string().min(1),
});

const outputSchemas = {
  "falcon24-business-review-18m": businessReviewSchema,
  "falcon24-delivery-experience-12m": deliverySchema,
  "falcon24-inventory-damage-12m": inventorySchema,
  "falcon24-marketing-lag-effect": marketingSchema,
  "falcon24-cohort-retention-m0-m6": cohortSchema,
} as const;

export const falcon24AnalysisOutputSchema = z.discriminatedUnion("case_id", [
  businessReviewSchema,
  deliverySchema,
  inventorySchema,
  marketingSchema,
  cohortSchema,
]);

export function falcon24AnalysisOutputJsonSchema(caseId: Falcon24AgentAnalysisCase["case_id"]) {
  return z.toJSONSchema(outputSchemas[caseId]);
}

type AnalysisOutput = z.infer<typeof falcon24AnalysisOutputSchema>;

export const FALCON24_ANALYSIS_CHART_VERSION = "falcon24-analysis-chart@1.0.0" as const;

function chartColumn(key: string, label: string, dataType: "STRING" | "NUMBER") {
  return { key, label, data_type: dataType } as const;
}

function normalizedIndex(value: number, baseline: number): number {
  if (baseline <= 0) throw new TypeError("FALCON24_CHART_BASELINE_INVALID");
  return (value / baseline) * 100;
}

export function buildFalcon24AnalysisChartProjection(
  input: unknown,
): ArtifactWorkspaceChartProjectionV3 {
  const output = falcon24AnalysisOutputSchema.parse(input);
  const projection: ArtifactWorkspaceChartProjectionV3 = (() => {
    switch (output.case_id) {
      case "falcon24-business-review-18m": {
        const baseline = output.monthly_kpis[0];
        if (!baseline) throw new TypeError("FALCON24_CHART_DATA_EMPTY");
        const rows = output.monthly_kpis.map((point) => ({
          month: point.month,
          revenue_index: normalizedIndex(point.revenue, baseline.revenue),
          order_count_index: normalizedIndex(point.order_count, baseline.order_count),
          average_order_value_index: normalizedIndex(
            point.average_order_value,
            baseline.average_order_value,
          ),
          revenue: point.revenue,
          order_count: point.order_count,
          average_order_value: point.average_order_value,
        }));
        return {
          kind: "CHART",
          chart_type: "LINE",
          title: "订单收入、订单量与客单价趋势（首月=100）",
          description: `三项指标按 ${baseline.month} 归一化，便于比较相对变化；表格同时保留绝对值。`,
          unit: "指数",
          x_key: "month",
          y_keys: ["revenue_index", "order_count_index", "average_order_value_index"],
          lower_bound_key: null,
          upper_bound_key: null,
          series_key: null,
          legend: { visible: true },
          evidence_level: "L2_OBSERVATION",
          table: {
            kind: "TABLE",
            columns: [
              chartColumn("month", "月份", "STRING"),
              chartColumn("revenue_index", "收入指数", "NUMBER"),
              chartColumn("order_count_index", "订单量指数", "NUMBER"),
              chartColumn("average_order_value_index", "客单价指数", "NUMBER"),
              chartColumn("revenue", "订单收入", "NUMBER"),
              chartColumn("order_count", "订单量", "NUMBER"),
              chartColumn("average_order_value", "客单价", "NUMBER"),
            ],
            rows,
            total_rows: rows.length,
          },
        };
      }
      case "falcon24-delivery-experience-12m": {
        const rows = [
          { period: "前6个月", ...output.six_vs_six.first },
          { period: "后6个月", ...output.six_vs_six.second },
        ];
        return {
          kind: "CHART",
          chart_type: "BAR",
          title: "配送时效前后 6 个月对比",
          description: "对比配送时长中位数与 P90；准时率和低评分率保留在同一图表数据表中。",
          unit: "分钟",
          x_key: "period",
          y_keys: ["p50_minutes", "p90_minutes"],
          lower_bound_key: null,
          upper_bound_key: null,
          series_key: null,
          legend: { visible: true },
          evidence_level: "L2_OBSERVATION",
          table: {
            kind: "TABLE",
            columns: [
              chartColumn("period", "观察区间", "STRING"),
              chartColumn("p50_minutes", "配送 P50", "NUMBER"),
              chartColumn("p90_minutes", "配送 P90", "NUMBER"),
              chartColumn("on_time_rate", "准时率", "NUMBER"),
              chartColumn("low_rating_rate", "低评分率", "NUMBER"),
            ],
            rows,
            total_rows: rows.length,
          },
        };
      }
      case "falcon24-inventory-damage-12m": {
        if (output.products.length === 0) {
          return {
            kind: "CHART",
            chart_type: "BAR",
            title: "高销量且损坏持续恶化商品命中数",
            description: "独立 Oracle 未验收出符合完整恶化条件的商品。",
            unit: "个",
            x_key: "status",
            y_keys: ["product_count"],
            lower_bound_key: null,
            upper_bound_key: null,
            series_key: null,
            legend: { visible: false },
            evidence_level: "L2_OBSERVATION",
            table: {
              kind: "TABLE",
              columns: [
                chartColumn("status", "状态", "STRING"),
                chartColumn("product_count", "商品数", "NUMBER"),
              ],
              rows: [{ status: "无命中", product_count: 0 }],
              total_rows: 1,
            },
          };
        }
        const rows = output.products.map((product) => ({
          product_id: product.product_id,
          category: product.category,
          sales_quantity: product.sales_quantity,
          damage_rate_change: product.last3_damage_rate - product.previous9_damage_rate,
          last3_damage_rate: product.last3_damage_rate,
          previous9_damage_rate: product.previous9_damage_rate,
          status: product.status,
        }));
        return {
          kind: "CHART",
          chart_type: "PRIORITY_MATRIX",
          title: "高销量商品库存损坏恶化优先矩阵",
          description: "横轴为销量，纵轴为近 3 月相对前 9 月损坏率变化，颜色区分优先级。",
          unit: null,
          x_key: "sales_quantity",
          y_keys: ["damage_rate_change"],
          lower_bound_key: null,
          upper_bound_key: null,
          series_key: "status",
          legend: { visible: true },
          evidence_level: "L2_OBSERVATION",
          table: {
            kind: "TABLE",
            columns: [
              chartColumn("product_id", "商品", "STRING"),
              chartColumn("category", "品类", "STRING"),
              chartColumn("sales_quantity", "销量", "NUMBER"),
              chartColumn("damage_rate_change", "损坏率变化", "NUMBER"),
              chartColumn("last3_damage_rate", "近3月损坏率", "NUMBER"),
              chartColumn("previous9_damage_rate", "前9月损坏率", "NUMBER"),
              chartColumn("status", "优先级", "STRING"),
            ],
            rows,
            total_rows: rows.length,
          },
        };
      }
      case "falcon24-marketing-lag-effect": {
        const rows = output.channel_audience_results.map((result) => ({
          channel_audience: `${result.channel} / ${result.target_audience}`,
          channel: result.channel,
          target_audience: result.target_audience,
          roas: result.roas,
          spend: result.spend,
          revenue_generated: result.revenue_generated,
          finding: result.group_finding,
        }));
        return {
          kind: "CHART",
          chart_type: "HORIZONTAL_BAR",
          title: "渠道与目标人群 ROAS 对比",
          description: "展示投放回报水平；关联判断与滞后期证据保留在图表数据表中。",
          unit: "倍",
          x_key: "channel_audience",
          y_keys: ["roas"],
          lower_bound_key: null,
          upper_bound_key: null,
          series_key: "finding",
          legend: { visible: true },
          evidence_level: "L2_OBSERVATION",
          table: {
            kind: "TABLE",
            columns: [
              chartColumn("channel_audience", "渠道 / 人群", "STRING"),
              chartColumn("channel", "渠道", "STRING"),
              chartColumn("target_audience", "目标人群", "STRING"),
              chartColumn("roas", "ROAS", "NUMBER"),
              chartColumn("spend", "投入", "NUMBER"),
              chartColumn("revenue_generated", "营销收入", "NUMBER"),
              chartColumn("finding", "关联判断", "STRING"),
            ],
            rows,
            total_rows: rows.length,
          },
        };
      }
      case "falcon24-cohort-retention-m0-m6": {
        const rows = output.cohorts.map((period) => ({
          series: `${period.registration_month} / ${period.customer_type}`,
          registration_cohort: period.registration_month,
          customer_segment: period.customer_type,
          month_index: period.month_index,
          retention_rate_pct: period.retention_rate * 100,
          repeat_purchase_rate_pct: period.repeat_purchase_rate * 100,
        }));
        return {
          kind: "CHART",
          chart_type: "LINE",
          title: "新客户 cohort M0-M6 留存与复购",
          description: "按注册月份和客户类型展示；主结论仍受注册与订单时序异常限制。",
          unit: "%",
          x_key: "month_index",
          y_keys: ["retention_rate_pct", "repeat_purchase_rate_pct"],
          lower_bound_key: null,
          upper_bound_key: null,
          series_key: "series",
          legend: { visible: true },
          evidence_level: "L2_OBSERVATION",
          table: {
            kind: "TABLE",
            columns: [
              chartColumn("series", "注册批次 / 客户类型", "STRING"),
              chartColumn("registration_cohort", "注册批次", "STRING"),
              chartColumn("customer_segment", "客户类型", "STRING"),
              chartColumn("month_index", "月龄", "NUMBER"),
              chartColumn("retention_rate_pct", "留存率", "NUMBER"),
              chartColumn("repeat_purchase_rate_pct", "复购率", "NUMBER"),
            ],
            rows,
            total_rows: rows.length,
          },
        };
      }
    }
  })();
  return artifactWorkspaceChartProjectionV3Schema.parse(projection);
}

export async function computeFalcon24AnalysisChartDatasetHash(input: unknown) {
  return computeArtifactWorkspaceChartDatasetV3Hash(buildFalcon24AnalysisChartProjection(input));
}

function assertWindow(
  window: { readonly start: string; readonly end_exclusive: string; readonly period_count: number },
  expectedPeriods: number,
) {
  if (
    window.start !== (expectedPeriods === 18 ? "2023-05-01" : "2023-11-01") ||
    window.end_exclusive !== "2024-11-01" ||
    window.period_count !== expectedPeriods
  ) {
    throw new TypeError("FALCON24_ORACLE_WINDOW_INVALID");
  }
}

function assertMethodEvidence(output: AnalysisOutput, testCase: Falcon24AgentAnalysisCase) {
  const observed = Object.keys(output.method_evidence).sort();
  if (JSON.stringify(observed) !== JSON.stringify(testCase.required_methods)) {
    throw new TypeError("FALCON24_ORACLE_METHOD_EVIDENCE_INVALID");
  }
}

function assertAssociationLanguage(conclusion: string) {
  if (!/关联/u.test(conclusion) || /(?:导致|证明.*影响|驱动了)/u.test(conclusion)) {
    throw new TypeError("FALCON24_ORACLE_CAUSAL_LANGUAGE_REJECTED");
  }
}

function evaluateBusinessReview(
  output: Extract<AnalysisOutput, { case_id: "falcon24-business-review-18m" }>,
) {
  assertWindow(output.window, 18);
  const months = output.monthly_kpis.map(({ month: value }) => value);
  if (
    new Set(months).size !== 18 ||
    months.some((value, index) => {
      const previous = months[index - 1];
      return previous !== undefined && value <= previous;
    })
  ) {
    throw new TypeError("FALCON24_Q1_MONTH_SERIES_INVALID");
  }
  for (const row of output.monthly_kpis) {
    const expected = row.active_buyers * row.orders_per_buyer * row.average_order_value;
    if (Math.abs(expected - row.revenue) > Math.max(0.01, Math.abs(row.revenue) * 1e-8)) {
      throw new TypeError("FALCON24_Q1_KPI_IDENTITY_NOT_CLOSED");
    }
  }
  const declines = output.monthly_kpis.slice(1).map((row, index) => {
    const previous = output.monthly_kpis[index];
    if (!previous) throw new TypeError("FALCON24_Q1_MONTH_SERIES_INVALID");
    return {
      month: row.month,
      absolute_change: row.revenue - previous.revenue,
      percent_change:
        previous.revenue === 0 ? 0 : (row.revenue - previous.revenue) / previous.revenue,
    };
  });
  const worst = declines.reduce((current, candidate) =>
    candidate.absolute_change < current.absolute_change ? candidate : current,
  );
  if (
    output.worst_revenue_decline.month !== worst.month ||
    Math.abs(output.worst_revenue_decline.absolute_change - worst.absolute_change) > 0.01 ||
    Math.abs(output.worst_revenue_decline.percent_change - worst.percent_change) > 1e-8
  ) {
    throw new TypeError("FALCON24_Q1_WORST_MONTH_INVALID");
  }
  const decomposition = output.shapley_decomposition;
  const summed =
    decomposition.buyer_contribution +
    decomposition.frequency_contribution +
    decomposition.aov_contribution;
  if (
    Math.abs(summed - decomposition.observed_revenue_change) > 0.01 ||
    decomposition.closure_error > 0.01
  ) {
    throw new TypeError("FALCON24_Q1_SHAPLEY_NOT_CLOSED");
  }
  const dimensions = new Set(output.segment_drivers.map(({ dimension }) => dimension));
  if (dimensions.size !== 3) throw new TypeError("FALCON24_Q1_SEGMENT_COVERAGE_INVALID");
}

function evaluateDelivery(
  output: Extract<AnalysisOutput, { case_id: "falcon24-delivery-experience-12m" }>,
) {
  assertWindow(output.window, 12);
  const adjusted = output.adjusted_binomial_glm[0];
  if (!adjusted) throw new TypeError("FALCON24_Q2_GLM_MISSING");
  if (
    output.six_vs_six.first.p90_minutes < output.six_vs_six.first.p50_minutes ||
    output.six_vs_six.second.p90_minutes < output.six_vs_six.second.p50_minutes
  ) {
    throw new TypeError("FALCON24_Q2_QUANTILES_INVALID");
  }
  const controls = new Set(adjusted.controls);
  for (const control of ["month", "log_order_amount", "product_category", "customer_segment"]) {
    if (!controls.has(control)) throw new TypeError("FALCON24_Q2_GLM_CONTROL_MISSING");
  }
  if (
    output.data_quality_precheck.invalid_delivery_orders !== 932 ||
    output.data_quality_precheck.valid_delivery_orders !== 2_127
  ) {
    throw new TypeError("FALCON24_Q2_DELIVERY_QUALITY_AUDIT_INVALID");
  }
  const expectedFinding =
    adjusted.delayed_p_value > 0.05
      ? "NOT_SIGNIFICANT"
      : adjusted.delayed_coefficient > 0
        ? "POSITIVE_SIGNIFICANT"
        : "NEGATIVE_SIGNIFICANT";
  if (adjusted.finding !== expectedFinding) {
    throw new TypeError("FALCON24_Q2_GLM_FINDING_INVALID");
  }
  assertAssociationLanguage(output.conclusion);
}

function evaluateInventory(
  output: Extract<AnalysisOutput, { case_id: "falcon24-inventory-damage-12m" }>,
) {
  assertWindow(output.window, 12);
  for (const product of output.products) {
    const qualifies =
      product.sales_quantity >= product.category_sales_p75 &&
      product.theil_sen_slope > 0 &&
      product.last3_damage_rate > product.previous9_damage_rate &&
      product.bh_q_value <= 0.05;
    if ((product.status === "PRIORITY") !== qualifies) {
      throw new TypeError("FALCON24_Q3_PRIORITY_CLASSIFICATION_INVALID");
    }
  }
}

function evaluateMarketing(
  output: Extract<AnalysisOutput, { case_id: "falcon24-marketing-lag-effect" }>,
) {
  if (
    output.window.start !== "2023-05-01" ||
    output.window.end_exclusive !== "2024-11-01" ||
    output.window.week_count !== 79
  ) {
    throw new TypeError("FALCON24_Q4_WEEK_WINDOW_INVALID");
  }
  const controls = new Set(output.controls);
  if (!controls.has("trend") || !controls.has("seasonality")) {
    throw new TypeError("FALCON24_Q4_CONTROL_MISSING");
  }
  for (const result of output.channel_audience_results) {
    if (
      result.business_outcomes.some(({ metric }, index) => metric !== marketingOutcomeIds[index])
    ) {
      throw new TypeError("FALCON24_Q4_BUSINESS_OUTCOME_COVERAGE_INVALID");
    }
  }
  assertAssociationLanguage(output.conclusion);
}

function evaluateCohort(
  output: Extract<AnalysisOutput, { case_id: "falcon24-cohort-retention-m0-m6" }>,
) {
  const months = [...new Set(output.cohorts.map(({ registration_month }) => registration_month))];
  if (months.length !== 12 || months[0] !== "2023-05" || months.at(-1) !== "2024-04") {
    throw new TypeError("FALCON24_Q5_COHORT_WINDOW_INVALID");
  }
  if (
    [...output.cohorts, ...output.sensitivity_cohorts].some(
      (row) =>
        row.pre_registration_event_count !== 1_186 ||
        row.pre_registration_customer_count !== 767 ||
        row.valid_ordering_customer_count !== 531 ||
        row.no_order_customer_count !== 209 ||
        row.invalid_delivery_event_count !== 931,
    )
  ) {
    throw new TypeError("FALCON24_Q5_QUALITY_AUDIT_INVALID");
  }
  for (const rows of [output.cohorts, output.sensitivity_cohorts]) {
    const groups = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) {
      const key = `${row.registration_month}\0${row.customer_type}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    if (
      groups.size !== 48 ||
      [...groups.values()].some(
        (periods) =>
          periods.length !== 7 || periods.some((period, index) => period.month_index !== index),
      )
    ) {
      throw new TypeError("FALCON24_Q5_MONTH_INDEX_INVALID");
    }
  }
  if (!/(?:不可靠|HOLD|异常)/u.test(output.conclusion)) {
    throw new TypeError("FALCON24_Q5_HOLD_DISCLOSURE_MISSING");
  }
}

const evaluators = {
  "falcon24-business-review-18m": evaluateBusinessReview,
  "falcon24-delivery-experience-12m": evaluateDelivery,
  "falcon24-inventory-damage-12m": evaluateInventory,
  "falcon24-marketing-lag-effect": evaluateMarketing,
  "falcon24-cohort-retention-m0-m6": evaluateCohort,
} as const;

export async function validateFalcon24AnalysisOutput(input: {
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly output: unknown;
}) {
  const caseId = falcon24AnalysisCaseIdSchema.parse(input.test_case.case_id);
  const output = falcon24AnalysisOutputSchema.parse(input.output);
  if (output.case_id !== caseId) throw new TypeError("FALCON24_ORACLE_CASE_BINDING_INVALID");
  assertMethodEvidence(output, input.test_case);
  (evaluators[caseId] as (value: never) => void)(output as never);
  const outputHash = await sha256ContentHash(output);
  return Object.freeze({
    output,
    output_hash: outputHash,
    chart_dataset_hash: await computeFalcon24AnalysisChartDatasetHash(output),
  });
}

export const falcon24AnalysisOracleInternals = Object.freeze({ evaluators });
