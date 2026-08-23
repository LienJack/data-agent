import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  analysisProgramPayloadSchema,
  researchBriefRefSchema,
} from "@data-agent/contracts/artifacts";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import type { Falcon24AgentAnalysisCase } from "@data-agent/contracts/evals";
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
    schema_version: "falcon24-marketing-output@1.0.0",
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

const FALCON24_METHOD_CONTRACTS = Object.freeze({
  "falcon24-business-review-18m": [
    "Treat order_id as the order grain for revenue, order count, buyers, frequency, and AOV; never sum order_total once per item row.",
    "Use exactly the 18 ordered calendar months 2023-05 through 2024-10 and identify the minimum absolute month-over-month revenue change.",
    "Close revenue = active_buyers * orders_per_buyer * average_order_value for every month.",
    "For the worst month transition, compute the three-factor buyer/frequency/AOV decomposition as the mean marginal contribution over all six factor permutations; require closure_error <= 0.01.",
    "For customer segment and payment method, compute member revenue on deduplicated orders; for product category, allocate each order_total across its item rows in proportion to nonnegative quantity, using equal shares when total quantity is zero.",
  ],
  "falcon24-delivery-experience-12m": [
    "Deduplicate to one row per order_id before delivery summaries or modeling; reject conflicting order-level values.",
    "Compare 2023-11 through 2024-04 with 2024-05 through 2024-10 and use linear interpolation quantiles for p50 and p90.",
    "Define low_rating as rating <= 2 and delayed as delivery_status != 'On Time'; fit a binomial-logit GLM on rated orders.",
    "The GLM design is intercept + delayed + log1p(order_total) + categorical month + product_category + customer_segment, with lexicographically first level as reference; report the delayed coefficient and two-sided Wald p-value.",
    "Only make association claims; never describe the delayed coefficient as causal.",
  ],
  "falcon24-inventory-damage-12m": [
    "Use blinkit_inventory only for the primary damage calculation; blinkit_inventoryNew is sensitivity evidence and must not be combined with primary values.",
    "For every product, compute monthly damage_rate = damaged_stock / stock_received, using zero when stock_received is zero; compute Theil-Sen as the median of all pairwise monthly slopes.",
    "Compute a two-sided Mann-Kendall trend p-value for all products, then Benjamini-Hochberg q-values across the full product family with monotone reverse correction.",
    "High sales means total product sales is at least the within-category product-sales p75 using linear interpolation.",
    "Return every product satisfying high sales, positive Theil-Sen slope, and last-3 mean damage rate greater than previous-9 mean; classify PRIORITY iff BH q <= 0.05, otherwise WATCHLIST.",
  ],
  "falcon24-marketing-lag-effect": [
    "At channel and target_audience grain, sort the 79 weekly rows and compute funnel totals, CTR, conversion rate, and ROAS.",
    "For each lag 0 through 4, regress weekly order_revenue on lagged spend with intercept, linear trend, sin(2*pi*week/52), and cos(2*pi*week/52); drop leading rows introduced by the lag.",
    "Compute the spend coefficient two-sided p-value using Newey-West HAC covariance with maxlags=4 and finite-sample factor n/(n-k).",
    "Select the lag with the smallest HAC p-value, breaking ties toward the smaller lag; apply Benjamini-Hochberg correction to selected p-values across all channel/audience groups.",
    "Classify GROWTH_ASSOCIATION iff coefficient > 0 and q <= 0.05; classify SPEND_WITHOUT_IMPROVEMENT iff the OLS slope of spend over week is positive and the selected result is not GROWTH_ASSOCIATION; otherwise NO_CLEAR_ASSOCIATION. Use association language only.",
  ],
  "falcon24-cohort-retention-m0-m6": [
    "Return every registration_cohort and customer_segment group with exactly M0 through M6 in order.",
    "At each point compute retention = active_customers/cohort_size, repeat purchase = repeat_customers/cohort_size, average spend = revenue/active_customers or null when inactive, plus delivery and rating means.",
    "Report the frozen anomaly audit exactly and set primary_reliable=false because pre-registration orders materially invalidate the primary cohort interpretation.",
    "Sensitivity excludes customers whose first order precedes registration, retains customers with no orders, and reports whether the substantive conclusion changes.",
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
  const requiredDimensions = input.test_case.required_semantic_keys
    .filter((key) => key.startsWith("dimension."))
    .map((key) => key.slice("dimension.".length));
  const dimensionRefs = requiredDimensions.filter((dimensionId) =>
    metrics.every((metric) =>
      metric.allowed_dimensions.some(
        (dimension) => dimension.dimension_id === dimensionId && dimension.groupable,
      ),
    ),
  );
  const descriptor = DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("open-python-analysis@1");
  const resultContract = FALCON24_RESULT_CONTRACTS[input.test_case.case_id];
  const material: Omit<AnalysisProgramPayload, "program_hash"> = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: context.context_hash,
    semantic_context_package_hash: context.semantic_context_binding.package_hash,
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
  windows: FALCON24_WINDOWS,
  result_contracts: FALCON24_RESULT_CONTRACTS,
});
