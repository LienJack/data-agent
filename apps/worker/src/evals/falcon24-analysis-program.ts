import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  researchBriefRefSchema,
} from "@data-agent/contracts/artifacts";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
import {
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  type StatisticalOperatorObligation,
} from "@data-agent/contracts/statistical-operators";
import { computeAnalysisProgramHash } from "../analysis/default-program.js";
import { DEFAULT_ANALYSIS_SKILL_CATALOG } from "../analysis/skill-catalog.js";

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
      operator_id: "cohort.registration-retention-m0-m6@1" as const,
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
    "Use exactly the 18 ordered calendar months 2023-05 through 2024-10 and identify the minimum absolute month-over-month revenue change. Report percent_change as the decimal ratio (current - previous) / previous, not percentage points.",
    "Close revenue = active_buyers * orders_per_buyer * average_order_value for every month.",
    "Prepare the worst-month buyer, frequency, and AOV baseline/current factors for the required exact product-Shapley operator. Use its returned contributions and closure evidence; do not implement Shapley permutations in generated Python.",
    "For customer segment and payment method, compute member revenue on deduplicated orders; for product category, allocate each order_total across its item rows in proportion to nonnegative quantity, using equal shares when total quantity is zero. Return exactly the most negative revenue-change member for each of the three dimensions, breaking ties lexicographically.",
  ],
  "falcon24-delivery-experience-12m": [
    "Deduplicate to one row per order_id before delivery summaries or modeling; reject conflicting order-level values.",
    "Compare 2023-11 through 2024-04 with 2024-05 through 2024-10 and use linear interpolation quantiles for p50 and p90.",
    "Define low_rating as rating <= 2 and delayed as delivery_status != 'On Time'. Prepare the rated-order design for the required binomial-logit/Wald operator: delayed, log1p(order_total), month, product_category, and customer_segment, with lexicographically first categorical levels as references.",
    "Use the operator's delayed coefficient, p-value, sample-size, rank, convergence, and iteration evidence. Set adjusted_binomial_glm.controls to exactly month, log_order_amount, product_category, and customer_segment; do not implement GLM fitting or Wald statistics in generated Python.",
    "For low-rating scenarios, use the lexicographically first product category per order, rank all category/segment/status groups by low-rating count descending, then rate descending, order count descending, and key ascending; return the first five or all groups when fewer exist.",
    "Write conclusion in Chinese association language, include the exact word 关联, and never use 导致, 证明...影响, 驱动了, or any causal description for the delayed coefficient.",
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
    "Build the complete 79-week calendar from Monday 2023-05-01 through Monday 2024-10-28. Set output.window to exactly {start:'2023-05-01', end_exclusive:'2024-11-01', week_count:79, grain:'WEEK'}; end_exclusive is the governed analysis boundary, not the day after the final Monday. First build one shared business_by_week series for order_revenue, new_customers, and order_count, asserting that duplicate input rows for a week agree. Analyze only distinct (channel,target_audience) tuples observed in the input; do not manufacture a Cartesian product. At that observed group grain, zero-fill only missing marketing measures (impressions, clicks, conversions, campaign_revenue, spend); every group-week must retain the shared business_by_week outcomes rather than replacing them with zero. Then compute funnel totals, CTR, conversion rate, and ROAS.",
    "For each business outcome in the exact order order_revenue, new_customers, order_count and each lag L from 0 through 4, prepare one OLS-HAC model: response business_outcome[L:79], predictors spend[0:79-L], absolute week index L..78, and annual sine/cosine controls. Also include one spend-over-week model per observed channel/audience group. Set controls to exactly ['trend','seasonality'].",
    "Call the required OLS-HAC operator once for the complete model batch with maxlags=4, Bartlett kernel, finite-sample correction enabled, and normal inference. Select the smallest spend-term p-value per group/outcome with smaller-lag tie break.",
    "For each business outcome separately, pass the selected full channel/audience p-value family to its required BH-FDR call. Classify from operator coefficients and adjusted p-values; use the spend-over-week operator coefficient for spend-growth status. Do not implement OLS, HAC covariance, p-values, or BH adjustment in generated Python, and use association language only.",
  ],
  "falcon24-cohort-retention-m0-m6": [
    "Prepare unique customer registrations, deduplicated order events, and the observation end month for the required cohort operator. Execute q5_primary_cohorts with pre_registration_policy='hold_primary', then q5_sensitivity_cohorts with pre_registration_policy='exclude_sensitivity'; do not implement cohort rates in generated Python.",
    "Return every registration_cohort and customer_segment group with exactly M0 through M6 in order, copying retention, repeat purchase, spend, delivery, rating, and data-quality evidence from the operator outputs.",
    "Report the frozen anomaly audit exactly and set primary_reliable=false because pre-registration orders materially invalidate the primary cohort interpretation.",
    "Sensitivity excludes customers whose first order precedes registration, retains customers with no orders, and sets conclusion_changed=true iff any cohort/segment/month primary retention differs from valid_active_customers/valid_timeline_customers by at least 0.05.",
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
  const requiredDimensions = input.test_case.required_semantic_keys.filter((key) =>
    key.startsWith("dimension."),
  );
  const dimensionRefs = requiredDimensions.filter((dimensionId) =>
    metrics.every((metric) =>
      metric.allowed_dimensions.some(
        (dimension) => dimension.dimension_id === dimensionId && dimension.groupable,
      ),
    ),
  );
  const descriptor = DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("open-python-analysis@1");
  const resultContract = FALCON24_RESULT_CONTRACTS[input.test_case.case_id];
  const operatorObligations = FALCON24_OPERATOR_OBLIGATIONS[input.test_case.case_id];
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
        dimension_refs: dimensionRefs,
        time_window: FALCON24_WINDOWS[input.test_case.case_id],
        comparison_window: null,
        parameters: {
          declared_method: input.test_case.required_methods.join("+"),
          acceptance_case_id: input.test_case.case_id,
          question: input.test_case.question,
          required_methods: [...input.test_case.required_methods],
          result_schema_version: resultContract.schema_version,
          required_output_fields: [...resultContract.required_fields],
          claim_strength: resultContract.claim_strength,
        },
        execution_mode: "MODEL_GENERATED",
        generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
        operator_obligations: operatorObligations,
        output_contract: descriptor.output_contract,
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
      max_elapsed_ms: 120_000,
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
});
