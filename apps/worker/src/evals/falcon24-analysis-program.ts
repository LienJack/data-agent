import {
  type AnalysisProgramPayload,
  type AnalysisResultContract,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  buildAnalysisResultContract,
  researchBriefRefSchema,
} from "@data-agent/contracts/artifacts";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import {
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  type StatisticalOperatorObligation,
} from "@data-agent/contracts/statistical-operators";
import { computeAnalysisProgramHash } from "../analysis/analysis-program-hash.js";
import { FALCON24_ANALYSIS_QUERY_SPECS } from "./falcon24-analysis-queries.js";

const FALCON24_WINDOWS = Object.freeze({
  "falcon24-business-review-18m": {
    start: "2023-05-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-delivery-experience-12m": {
    start: "2023-11-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-inventory-damage-12m": {
    start: "2023-11-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-marketing-lag-effect": {
    start: "2023-05-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
  "falcon24-cohort-retention-m0-m6": {
    start: "2023-05-01T00:00:00.000Z",
    end: "2024-11-01T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    semantics: "HALF_OPEN",
  },
} as const);

const FALCON24_RESULT_CONTRACTS = Object.freeze({
  "falcon24-business-review-18m": {
    schema_version: "falcon24-business-review-output@1.0.0",
    required_fields: [
      "window",
      "monthly_kpis",
      "worst_revenue_decline",
      "shapley_decomposition",
      "segment_drivers",
      "method_evidence",
      "conclusion",
    ],
    claim_strength: "DESCRIPTIVE",
  },
  "falcon24-delivery-experience-12m": {
    schema_version: "falcon24-delivery-output@1.0.0",
    required_fields: [
      "window",
      "data_quality_precheck",
      "six_vs_six",
      "adjusted_binomial_glm",
      "low_rating_scenarios",
      "method_evidence",
      "claim_strength",
      "conclusion",
    ],
    claim_strength: "ASSOCIATION_ONLY",
  },
  "falcon24-inventory-damage-12m": {
    schema_version: "falcon24-inventory-output@1.0.0",
    required_fields: [
      "window",
      "primary_source",
      "sensitivity_source",
      "sensitivity_combined_with_primary",
      "products",
      "method_evidence",
      "conclusion",
    ],
    claim_strength: "DESCRIPTIVE",
  },
  "falcon24-marketing-lag-effect": {
    schema_version: "falcon24-marketing-output@2.0.0",
    required_fields: [
      "window",
      "channel_audience_results",
      "controls",
      "method_evidence",
      "claim_strength",
      "conclusion",
    ],
    claim_strength: "ASSOCIATION_ONLY",
  },
  "falcon24-cohort-retention-m0-m6": {
    schema_version: "falcon24-cohort-output@1.0.0",
    required_fields: [
      "cohort_window",
      "anomaly_precheck",
      "primary_reliable",
      "cohorts",
      "sensitivity",
      "method_evidence",
      "conclusion",
    ],
    claim_strength: "HOLD_WITH_SENSITIVITY",
  },
} as const);

type Falcon24CaseId = Falcon24AgentAnalysisCase["case_id"];
type Falcon24TableColumn = AnalysisResultContract["tables"][number]["columns"][number];

const tableColumn = (
  key: string,
  label_zh: string,
  data_type: Falcon24TableColumn["data_type"],
  semantic_role: Falcon24TableColumn["semantic_role"],
  nullable = false,
) => ({ key, label_zh, data_type, semantic_role, nullable });

const FALCON24_PRESENTATION_CONTRACTS = Object.freeze({
  "falcon24-business-review-18m": {
    table_id: "business_monthly_kpis",
    title_zh: "近18个月经营指标趋势",
    columns: [
      tableColumn("month", "月份", "STRING", "DIMENSION"),
      tableColumn("revenue", "订单收入", "NUMBER", "METRIC"),
      tableColumn("order_count", "订单量", "NUMBER", "METRIC"),
      tableColumn("active_buyers", "购买人数", "NUMBER", "METRIC"),
      tableColumn("orders_per_buyer", "人均购买频次", "NUMBER", "METRIC"),
      tableColumn("average_order_value", "客单价", "NUMBER", "METRIC"),
    ],
    chart: {
      chart_id: "business_kpi_trend",
      title_zh: "经营指标月度趋势",
      intent: "TREND" as const,
      template_id: "line.multi-series@1" as const,
    },
  },
  "falcon24-delivery-experience-12m": {
    table_id: "delivery_period_comparison",
    title_zh: "配送与低评分前后期对比",
    columns: [
      tableColumn("period", "期间", "STRING", "DIMENSION"),
      tableColumn("average_delivery_minutes", "平均配送分钟", "NUMBER", "METRIC"),
      tableColumn("p90_delivery_minutes", "P90配送分钟", "NUMBER", "METRIC"),
      tableColumn("low_rating_rate", "低评分率", "NUMBER", "METRIC"),
      tableColumn("order_revenue", "订单收入", "NUMBER", "METRIC"),
    ],
    chart: {
      chart_id: "delivery_experience_comparison",
      title_zh: "配送时效与低评分对比",
      intent: "COMPARISON" as const,
      template_id: "bar.grouped@1" as const,
    },
  },
  "falcon24-inventory-damage-12m": {
    table_id: "inventory_damage_priority",
    title_zh: "高销量持续恶化商品排查优先级",
    columns: [
      tableColumn("product_id", "商品ID", "STRING", "DIMENSION"),
      tableColumn("product_name", "商品", "STRING", "DIMENSION"),
      tableColumn("category", "品类", "STRING", "DIMENSION"),
      tableColumn("total_sales", "销量", "NUMBER", "METRIC"),
      tableColumn("previous9_damage_rate", "前9月损坏率", "NUMBER", "METRIC"),
      tableColumn("last3_damage_rate", "近3月损坏率", "NUMBER", "METRIC"),
      tableColumn("theil_sen_slope", "Theil-Sen斜率", "NUMBER", "METRIC"),
      tableColumn("adjusted_p_value", "FDR校正P值", "NUMBER", "METRIC"),
      tableColumn("classification", "优先级", "STRING", "DERIVED"),
    ],
    chart: {
      chart_id: "inventory_damage_priority_matrix",
      title_zh: "库存损坏排查优先级矩阵",
      intent: "PRIORITY" as const,
      template_id: "matrix.priority@1" as const,
    },
  },
  "falcon24-marketing-lag-effect": {
    table_id: "marketing_lag_results",
    title_zh: "渠道与人群投入滞后关联",
    columns: [
      tableColumn("channel", "渠道", "STRING", "DIMENSION"),
      tableColumn("target_audience", "目标人群", "STRING", "DIMENSION"),
      tableColumn("outcome", "业务结果", "STRING", "DIMENSION"),
      tableColumn("lag", "滞后周数", "INTEGER", "DIMENSION"),
      tableColumn("coefficient", "关联系数", "NUMBER", "METRIC"),
      tableColumn("adjusted_p_value", "FDR校正P值", "NUMBER", "METRIC"),
      tableColumn("spend_growth", "投入趋势", "STRING", "DERIVED"),
    ],
    chart: {
      chart_id: "marketing_spend_business_relationship",
      title_zh: "营销投入与后续业务增长关联",
      intent: "RELATIONSHIP" as const,
      template_id: "scatter.relationship@1" as const,
    },
  },
  "falcon24-cohort-retention-m0-m6": {
    table_id: "cohort_retention_m0_m6",
    title_zh: "新客户批次M0-M6留存与体验",
    columns: [
      tableColumn("registration_cohort", "注册批次", "STRING", "DIMENSION"),
      tableColumn("customer_segment", "客户类型", "STRING", "DIMENSION"),
      tableColumn("month_index", "生命周期月", "INTEGER", "DIMENSION"),
      tableColumn("retention_rate", "留存率", "NUMBER", "METRIC"),
      tableColumn("repeat_purchase_rate", "复购率", "NUMBER", "METRIC"),
      tableColumn("average_spend", "人均消费", "NUMBER", "METRIC", true),
      tableColumn("average_delivery_minutes", "平均配送分钟", "NUMBER", "METRIC", true),
      tableColumn("average_rating", "平均评分", "NUMBER", "METRIC", true),
      tableColumn("analysis_mode", "分析口径", "STRING", "DERIVED"),
    ],
    chart: {
      chart_id: "cohort_retention_curve",
      title_zh: "不同注册批次M0-M6留存曲线",
      intent: "RETENTION" as const,
      template_id: "cohort.retention@1" as const,
    },
  },
} satisfies Record<
  Falcon24CaseId,
  {
    readonly table_id: string;
    readonly title_zh: string;
    readonly columns: readonly Omit<Falcon24TableColumn, "semantic_object_id">[];
    readonly chart: {
      readonly chart_id: string;
      readonly title_zh: string;
      readonly intent: AnalysisResultContract["charts"][number]["intent"];
      readonly template_id: AnalysisResultContract["charts"][number]["allowed_template_ids"][number];
    };
  }
>);

function matchingDimensions(
  testCase: Falcon24AgentAnalysisCase,
  metrics: readonly Awaited<ReturnType<typeof verifyAnalysisContext>>["metrics"][number][],
): readonly string[] {
  const authorized = new Set(
    metrics.flatMap(({ allowed_dimensions }) =>
      allowed_dimensions
        .filter(({ groupable }) => groupable)
        .map(({ dimension_id }) => dimension_id),
    ),
  );
  return testCase.required_semantic_keys
    .filter((key) => key.startsWith("dimension."))
    .map((key) => [key, key.slice("dimension.".length)])
    .flatMap((candidates) => candidates.find((candidate) => authorized.has(candidate)) ?? [])
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
}

async function compileFalcon24ResultContract(input: {
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly semantic_context_hash: `sha256:${string}`;
  readonly metrics: readonly Awaited<ReturnType<typeof verifyAnalysisContext>>["metrics"][number][];
  readonly dimension_ids: readonly string[];
}): Promise<AnalysisResultContract> {
  const resultShape = FALCON24_RESULT_CONTRACTS[input.test_case.case_id];
  const presentation = FALCON24_PRESENTATION_CONTRACTS[input.test_case.case_id];
  const query = FALCON24_ANALYSIS_QUERY_SPECS[input.test_case.case_id];
  const datasetField = resultShape.required_fields.find((field) =>
    /(?:monthly_kpis|six_vs_six|products|channel_audience_results|cohorts)/u.test(field),
  );
  if (!datasetField) throw new TypeError("FALCON24_RESULT_DATASET_FIELD_MISSING");
  const semanticSources = [
    ...input.metrics.map(({ metric_ref }) => metric_ref.node_id),
    ...input.dimension_ids,
  ];
  const physicalSources = query.columns.map(({ name }) => `${query.input_name}.${name}`);
  const resultFields = ["schema_version", "case_id", ...resultShape.required_fields].map(
    (field) => {
      const stringField =
        field === "schema_version" ||
        field === "case_id" ||
        field === "claim_strength" ||
        field === "conclusion";
      const associationConclusion =
        field === "conclusion" && resultShape.claim_strength === "ASSOCIATION_ONLY";
      return {
        field,
        data_type: stringField ? ("STRING" as const) : ("JSON" as const),
        nullable: false,
        semantic_role: "DERIVED" as const,
        ...(associationConclusion
          ? {
              text_constraints: {
                required_substrings: ["关联"],
                forbidden_substrings: ["导致", "证明", "驱动"],
                required_suffix:
                  input.test_case.case_id === "falcon24-delivery-experience-12m"
                    ? "该证据仅支持统计关联，不支持因果判断。"
                    : null,
              },
            }
          : {}),
      };
    },
  );
  const timeDimension =
    input.dimension_ids.find((id) => /(?:month|week|cohort|date)/u.test(id)) ?? null;
  const timeGrain = timeDimension
    ? input.test_case.case_id === "falcon24-marketing-lag-effect"
      ? ("WEEK" as const)
      : ("MONTH" as const)
    : ("NONE" as const);
  const fallbackSemanticId = input.metrics[0]?.metric_ref.node_id;
  if (!fallbackSemanticId) throw new TypeError("FALCON24_RESULT_METRIC_MISSING");
  return buildAnalysisResultContract({
    schema_version: "analysis-result-contract@1.0.0",
    contract_id: `${input.test_case.case_id}.result`,
    semantic_context_hash: input.semantic_context_hash,
    result_fields: resultFields,
    metric_bindings: input.metrics.map((metric) => ({
      semantic_metric_id: metric.metric_ref.node_id,
      field: datasetField,
      unit: metric.unit?.unit_id ?? query.semantic_contract.unit,
      aggregation: "NONE",
      formula_hash: metric.formula_hash,
    })),
    dimension_bindings: input.dimension_ids.map((semantic_dimension_id) => ({
      semantic_dimension_id,
      field: datasetField,
    })),
    grain: {
      dimension_ids: [...input.dimension_ids],
      time_dimension_id: timeDimension,
      time_grain: timeGrain,
    },
    lineage: resultFields.map(({ field }) => ({
      field,
      source_semantic_object_ids: semanticSources,
      source_physical_fields: physicalSources,
      transformation: "FORMULA" as const,
    })),
    tables: [
      {
        table_id: presentation.table_id,
        title_zh: presentation.title_zh,
        required: true,
        columns: presentation.columns.map((column) => ({
          ...column,
          semantic_object_id:
            column.semantic_role === "DIMENSION"
              ? (input.dimension_ids.find((id) =>
                  id.includes(column.key.replace(/^(?:customer_|target_)/u, "")),
                ) ?? fallbackSemanticId)
              : fallbackSemanticId,
        })),
        max_rows: 5_000,
      },
    ],
    charts: [
      {
        chart_id: presentation.chart.chart_id,
        title_zh: presentation.chart.title_zh,
        required: true,
        intent: presentation.chart.intent,
        table_id: presentation.table_id,
        allowed_template_ids: [presentation.chart.template_id],
      },
    ],
    limits: {
      max_result_bytes: 16 * 1024 * 1024,
      max_table_rows: 5_000,
      max_table_columns: 128,
      max_closure_bytes: 64 * 1024 * 1024,
    },
  });
}

const exactBinding = (field: string) => ({
  result_field: field,
  operator_field: field,
  comparison: "EXACT" as const,
  absolute_tolerance: 0,
  relative_tolerance: 0,
});

const resultBinding = (input: {
  readonly result_collection_path: string;
  readonly operator_collection_path: string;
  readonly label_fields: readonly string[];
  readonly value_fields: readonly string[];
}) => ({
  result_output_name: "result",
  result_collection_path: input.result_collection_path,
  operator_collection_path: input.operator_collection_path,
  label_fields: [...input.label_fields],
  value_bindings: input.value_fields.map(exactBinding),
  require_exact_label_set: true as const,
});

const FALCON24_OPERATOR_OBLIGATIONS = Object.freeze({
  "falcon24-business-review-18m": [
    {
      call_id: "q1_revenue_identity",
      operator_id: "decomposition.product-shapley-exact@1",
      result_binding: resultBinding({
        result_collection_path: "/method_evidence/buyers-frequency-aov-shapley/contributions",
        operator_collection_path: "/contributions",
        label_fields: ["label", "factor"],
        value_fields: ["contribution"],
      }),
    },
  ],
  "falcon24-delivery-experience-12m": [
    {
      call_id: "q2_delivery_low_rating",
      operator_id: "regression.binomial-logit-wald@1",
      result_binding: resultBinding({
        result_collection_path: "/method_evidence/adjusted-binomial-glm/coefficients",
        operator_collection_path: "/coefficients",
        label_fields: ["label", "term"],
        value_fields: ["coefficient", "standard_error", "wald_z", "p_value"],
      }),
    },
  ],
  "falcon24-inventory-damage-12m": [
    {
      call_id: "q3_theil_sen_all_products",
      operator_id: "robust-trend.theil-sen-slope@1",
      result_binding: resultBinding({
        result_collection_path: "/method_evidence/theil-sen-deterioration/theil_sen/series",
        operator_collection_path: "/series",
        label_fields: ["label"],
        value_fields: ["slope"],
      }),
    },
    {
      call_id: "q3_mann_kendall_all_products",
      operator_id: "trend.mann-kendall-original@1",
      result_binding: resultBinding({
        result_collection_path: "/method_evidence/theil-sen-deterioration/mann_kendall/series",
        operator_collection_path: "/series",
        label_fields: ["label"],
        value_fields: ["p_value", "trend", "rejected"],
      }),
    },
    {
      call_id: "q3_bh_all_products",
      operator_id: "multiple-testing.bh-fdr@1",
      result_binding: resultBinding({
        result_collection_path: "/method_evidence/benjamini-hochberg-fdr/tests",
        operator_collection_path: "/tests",
        label_fields: ["label"],
        value_fields: ["adjusted_p_value", "rejected"],
      }),
    },
  ],
  "falcon24-marketing-lag-effect": [
    {
      call_id: "q4_hac_all_models",
      operator_id: "regression.ols-hac@1",
      result_binding: resultBinding({
        result_collection_path: "/method_evidence/hac-standard-errors/coefficients",
        operator_collection_path: "/coefficients",
        label_fields: ["label", "term"],
        value_fields: ["coefficient", "standard_error", "statistic", "p_value"],
      }),
    },
    ...(["order_revenue", "new_customers", "order_count"] as const).map((metric) => ({
      call_id: `q4_bh_${metric}`,
      operator_id: "multiple-testing.bh-fdr@1" as const,
      result_binding: resultBinding({
        result_collection_path: `/method_evidence/multiple-testing-fdr/${metric}/tests`,
        operator_collection_path: "/tests",
        label_fields: ["label"],
        value_fields: ["adjusted_p_value", "rejected"],
      }),
    })),
  ],
  "falcon24-cohort-retention-m0-m6": [
    ...(["primary", "sensitivity"] as const).map((mode) => ({
      call_id: `q5_${mode}_cohorts`,
      operator_id: "cohort.registration-retention-m0-m6@2" as const,
      result_binding: resultBinding({
        result_collection_path: `/method_evidence/cohort-m0-m6/${mode}/cohort_periods`,
        operator_collection_path: "/cohort_periods",
        label_fields: ["registration_month", "customer_type", "month_index"],
        value_fields: [
          "eligible_customers",
          "active_customers",
          "retention_rate",
          "repeat_customers",
          "repeat_purchase_rate",
          "order_count",
          "revenue",
          "average_spend",
          "average_delivery_minutes",
          "average_rating",
        ],
      }),
    })),
  ],
} satisfies Record<Falcon24AgentAnalysisCase["case_id"], readonly StatisticalOperatorObligation[]>);

const FALCON24_METHOD_CONTRACTS = Object.freeze({
  "falcon24-business-review-18m": [
    "Treat order_id as the order grain for revenue, order count, buyers, frequency, and AOV; never sum order_total once per item row.",
    "Use exactly the 18 ordered calendar months 2023-05 through 2024-10 and identify the minimum signed month-over-month revenue change (the most negative current revenue minus previous revenue), never the smallest absolute magnitude. Report percent_change as the decimal ratio (current - previous) / previous, not percentage points.",
    "For the worst-month comparison, set current_month from the selected ordered row and previous_month from the immediately preceding ordered row's month field; never use prev_revenue or another metric value as a time key. Assert that both month slices are non-empty and every Shapley factor is finite before invoking the operator, using data-free identifiers such as PREVIOUS_MONTH_EMPTY and SHAPLEY_FACTOR_NON_FINITE.",
    "Close revenue = active_buyers * orders_per_buyer * average_order_value for every month.",
    "Prepare exactly one product-Shapley comparison labeled worst_month_revenue_change. Its baseline_factors and current_factors must use exactly the keys active_buyers, orders_per_buyer, and average_order_value. After the operator succeeds, index its protected contributions collection by factor. Set buyer_contribution from active_buyers, frequency_contribution from orders_per_buyer, and aov_contribution from average_order_value; set observed_revenue_change and closure_error from the operator rows' delta and closure_error evidence. Preserve all returned contribution rows at method_evidence['buyers-frequency-aov-shapley'].contributions. Never invent parallel scalar variables or implement Shapley permutations in generated Python.",
    "Prepare and retain one monthly_kpis_table plus the selected current/previous month and signed/percent change before the operator call. After binding the operator result, reuse those named values directly for result and table publication; do not rebuild or replace monthly_kpis_table or access an unprepared abs_change column in a new object.",
    "For customer segment and payment method, compute member revenue on deduplicated orders; for product category, first clip every item-row quantity to max(quantity, 0), then allocate each order_total in proportion to those clipped quantities, using equal shares when their per-order total is zero. For all three dimensions, revenue_change is exclusively selected current worst-month revenue minus its immediately previous-month revenue, never the last calendar month's generic diff. Return exactly the most negative member for each dimension, breaking ties lexicographically.",
  ],
  "falcon24-delivery-experience-12m": [
    "Deduplicate to one row per order_id before delivery summaries or modeling; reject conflicting order-level values. Assert invalid_delivery_orders is one repeated constant, report it exactly in data_quality_precheck, and exclude null delivery_time_minutes (server-normalized from negative source durations) from delivery-duration summaries while retaining those orders for rating and GLM analysis.",
    "Compare 2023-11 through 2024-04 with 2024-05 through 2024-10 and use linear interpolation quantiles for p50 and p90 over valid non-negative delivery durations only. Build delivery_period_comparison with exactly two rows and the exact contract columns: average_delivery_minutes is the arithmetic mean of valid delivery_time_minutes, p90_delivery_minutes is that period's p90, low_rating_rate uses rated orders only, and order_revenue is the sum of order_total across all period orders. Every required table value is finite and non-null; never use NaN or a placeholder.",
    "Define low_rating as rating <= 2 and delayed as delivery_status != 'On Time'. Prepare exactly one rated-order model with label='delivery_low_rating_adjusted'. Its predictors mapping must use the exact keys delayed and log_order_amount, where log_order_amount is the natural logarithm np.log(order_total) after asserting strictly positive order_total, plus deterministic month=<YYYY-MM>, product_category=<level>, and customer_segment=<level> dummy keys with lexicographically first levels omitted as references. Convert the outcome and every predictor vector to a plain Python list with .tolist() before assigning the server-declared inputs symbol; no pandas Series or numpy ndarray may remain nested in the operator mapping.",
    "From the protected coefficients collection select exactly one row with label='delivery_low_rating_adjusted' and term='delayed'; copy its coefficient, p_value, sample_size, rank, converged, and iterations evidence. Set adjusted_binomial_glm.controls to exactly month, log_order_amount, product_category, and customer_segment. Set finding to NOT_SIGNIFICANT when p_value>0.05, otherwise POSITIVE_SIGNIFICANT for a positive coefficient or NEGATIVE_SIGNIFICANT for a negative coefficient. Do not implement GLM fitting or Wald statistics in generated Python.",
    "For low-rating scenarios, use the lexicographically first product category per order, rank all category/segment/status groups by low-rating count descending, then rate descending, order count descending, and key ascending; return the first five or all groups when fewer exist.",
    "Write conclusion in Chinese association language and include the exact word 关联. Its final sentence must be exactly '该证据仅支持统计关联，不支持因果判断。'. Do not include the words 导致, 证明, 驱动 anywhere, including negations. Disclose exactly 932 invalid delivery durations. When finding is NOT_SIGNIFICANT, state that the adjusted association is not significant and that delivery delay cannot be identified as the main association factor; only POSITIVE_SIGNIFICANT may identify it as the main association factor, while NEGATIVE_SIGNIFICANT must state the opposite direction.",
  ],
  "falcon24-inventory-damage-12m": [
    "Use blinkit_inventory only for the primary damage calculation; blinkit_inventoryNew is sensitivity evidence and must not be combined with primary values.",
    "For every product, sort the 12 rows by month ascending and compute monthly damage_rate = damaged_stock / stock_received, using zero when stock_received is zero. Prepare zero-based x=0..11 series for the required Theil-Sen operator and ordered series for the required original Mann-Kendall operator.",
    "Pass every product's Mann-Kendall raw p-value to the required BH-FDR operator before any candidate filtering. Use the three operator results as the only source of slopes, raw p-values, adjusted p-values, and rejection flags; do not reimplement these statistical formulas.",
    "Return full finite floating-point values for damage rates, Theil-Sen slopes, raw p-values, and BH q-values; do not round or format any numeric output before context.write_json.",
    "High sales means total product sales is at least the within-category product-sales p75 using linear interpolation.",
    "Return every product satisfying high sales, positive Theil-Sen slope, and last-3 mean damage rate greater than previous-9 mean; classify PRIORITY iff BH q <= 0.05, otherwise WATCHLIST.",
  ],
  "falcon24-marketing-lag-effect": [
    "The governed input is already the complete 79-week grid for exactly the 16 observed (channel,target_audience) groups, from Monday 2023-05-01 through Monday 2024-10-28. The authoritative week field is week_start; there is no business_week field. Set output.window to exactly {start:'2023-05-01', end_exclusive:'2024-11-01', week_count:79, grain:'WEEK'} and assert each group has the same 79 ordered week_start values. Use the repeated order_revenue, new_customers, and order_count values as one shared business_by_week series after asserting duplicates agree. Marketing measures are already zero-filled by the governed query. Then compute funnel totals, CTR, conversion rate, and ROAS.",
    "For each business outcome in the exact order order_revenue, new_customers, order_count and each lag L from 0 through 4, prepare one OLS-HAC model: response business_outcome[L:79], predictors spend[0:79-L], absolute week index L..78, and annual sine/cosine controls. Also include one spend-over-week model per observed channel/audience group. Set controls to exactly ['trend','seasonality'].",
    "Call the required OLS-HAC operator once for the complete model batch with maxlags=4, Bartlett kernel, finite-sample correction enabled, and normal inference. Use lag model labels exactly channel|target_audience|outcome|lagN (four pipe-separated parts) and spend trend labels exactly channel|target_audience|spend_over_week (three parts); parse those exact cardinalities after the operator returns. For four-part lag labels, retain only coefficient rows whose term is exactly 'spend' and ignore every intercept/control-term row. For three-part spend-trend labels, retain only the row whose term is exactly 'week_index'. Assert that this yields exactly 16*3*5 spend rows and exactly 16 week_index trend rows. Select the smallest retained spend-term p-value per group/outcome with smaller-lag tie break and assert all 16 labels exist in each BH family before its call.",
    "For each business outcome separately, pass the selected full channel/audience p-value family to its required BH-FDR call. Classify each outcome as GROWTH_ASSOCIATION exactly when its selected coefficient is positive and adjusted p-value is <=0.05; otherwise classify SPEND_WITHOUT_IMPROVEMENT exactly when that channel/audience spend-over-week coefficient is positive, else NO_CLEAR_ASSOCIATION. Group finding is GROWTH_ASSOCIATION when any outcome has it, otherwise SPEND_WITHOUT_IMPROVEMENT when spend-over-week is positive, else NO_CLEAR_ASSOCIATION. Do not implement OLS, HAC covariance, p-values, or BH adjustment in generated Python, and use association language only.",
    "At method_evidence['hac-standard-errors'].coefficients and each multiple-testing-fdr result_binding path, retain the exact protected operator collection without DataFrame conversion; null operator evidence must remain Python None rather than pandas NaN. Build marketing_lag_results only from selected finite spend-term coefficients and adjusted p-values, with no null, NaN, or infinity in its non-nullable columns.",
  ],
  "falcon24-cohort-retention-m0-m6": [
    "The governed input is at registered-customer/order-event grain. Deduplicate customers by customer_id using the exact fields customer_id, registration_date, and customer_type. Build events only from rows with non-null order_id using the exact fields customer_id, event_date, order_id, revenue, delivery_minutes, and rating (source average_rating). Convert registration_date and non-null event_date values to exact ISO YYYY-MM-DD strings before the operator call; do not reduce them to months. Construct nullable numeric event fields explicitly as Python float or None; do not pass DataFrame.to_dict records containing pandas/numpy NaN. Convert negative delivery_minutes to None before the operator call and never use them in delivery averages. Assert observation_end_month and invalid_delivery_orders are each one repeated constant; pass integer invalid_delivery_orders as observation.invalid_delivery_event_count. Execute q5_primary_cohorts with pre_registration_policy='hold_primary', then q5_sensitivity_cohorts with pre_registration_policy='exclude_sensitivity'; both use horizon_months=6 and duplicate_customer_policy='reject'. Do not implement cohort rates in generated Python.",
    "Return every registration_cohort and customer_segment group with exactly M0 through M6 in order, copying retention, repeat purchase, spend, delivery, rating, and data-quality evidence from the operator outputs. Derive cohort_window only from the distinct protected primary cohort_periods.registration_month values, never from distinct registration_date days: first_cohort='2023-05', last_cohort='2024-04', cohort_count=12, observation_months=7.",
    "Report the five constant cohort-scoped anomaly columns, including invalid_delivery_orders, from the governed input exactly and set primary_reliable=false because temporal anomalies materially invalidate the primary cohort interpretation and negative delivery durations invalidate unfiltered experience averages.",
    "Sensitivity excludes the customers identified by the @2 operator from exact-day event_date < registration_date comparisons, retains customers with no orders, and sets conclusion_changed=true iff any cohort/segment/month primary and sensitivity retention_rate differ by at least 0.05.",
    "The terminal conclusion must disclose that the primary analysis is unreliable/HOLD and must not silently promote sensitivity results to primary truth.",
  ],
} as const);

export async function createFalcon24AnalysisProgram(input: {
  readonly test_case: Falcon24AgentAnalysisCase;
  readonly brief_ref: ArtifactReference;
  readonly context: AnalysisContext;
  readonly metric_ids: readonly string[];
}): Promise<AnalysisProgramPayload> {
  const context = await verifyAnalysisContext(input.context);
  const briefRef = researchBriefRefSchema.parse(input.brief_ref);
  const metrics = input.metric_ids.map((metricId) => {
    const metric = context.metrics.find(
      ({ metric_ref: metricRef }) => metricRef.node_id === metricId,
    );
    if (!metric) throw new TypeError(`FALCON24_ANALYSIS_METRIC_MISSING:${metricId}`);
    return metric;
  });
  if (metrics.length === 0) throw new TypeError("FALCON24_ANALYSIS_METRICS_EMPTY");
  const dimensionRefs = matchingDimensions(input.test_case, metrics);
  const resultShape = FALCON24_RESULT_CONTRACTS[input.test_case.case_id];
  const resultContract = await compileFalcon24ResultContract({
    test_case: input.test_case,
    semantic_context_hash: context.semantic_context_binding.package_hash as `sha256:${string}`,
    metrics,
    dimension_ids: dimensionRefs,
  });
  const operatorObligations = FALCON24_OPERATOR_OBLIGATIONS[input.test_case.case_id];
  if (
    JSON.stringify(
      operatorObligations.map(({ call_id: callId, operator_id: operatorId }) => ({
        call_id: callId,
        operator_id: operatorId,
      })),
    ) !== JSON.stringify(input.test_case.required_operator_calls)
  ) {
    throw new TypeError("FALCON24_ANALYSIS_OPERATOR_REQUIREMENT_MISMATCH");
  }
  const material: Omit<AnalysisProgramPayload, "program_hash"> = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: context.context_hash,
    semantic_context_package_hash: context.semantic_context_binding.package_hash,
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    nodes: [
      {
        node_id: input.test_case.case_id,
        skill_id: "open-python-analysis@1",
        metric_refs: metrics.map(({ metric_ref: metricRef }) => metricRef),
        dimension_refs: [...dimensionRefs],
        time_window: FALCON24_WINDOWS[input.test_case.case_id],
        comparison_window: null,
        parameters: {
          declared_method: input.test_case.required_methods.join("+"),
          acceptance_case_id: input.test_case.case_id,
          question: input.test_case.question,
          required_methods: [...input.test_case.required_methods],
          result_schema_version: resultShape.schema_version,
          required_output_fields: [...resultShape.required_fields],
          claim_strength: resultShape.claim_strength,
        },
        execution_mode: "MODEL_GENERATED",
        generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
        operator_obligations: operatorObligations,
        result_contract: resultContract,
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      },
    ],
    budget: {
      max_steps: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_series_rows: 5_000,
      max_group_rows: 5_000,
      max_elapsed_ms: 300_000,
    },
    compiler_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    compiler_version: "falcon24-agent-analysis-compiler@1.0.0",
  };
  return analysisProgramPayloadSchema.parse({
    ...material,
    program_hash: await computeAnalysisProgramHash(material),
  });
}

export const falcon24AnalysisProgramInternals = Object.freeze({
  method_contracts: FALCON24_METHOD_CONTRACTS,
  operator_obligations: FALCON24_OPERATOR_OBLIGATIONS,
  windows: FALCON24_WINDOWS,
  result_contracts: FALCON24_RESULT_CONTRACTS,
  presentation_contracts: FALCON24_PRESENTATION_CONTRACTS,
});
