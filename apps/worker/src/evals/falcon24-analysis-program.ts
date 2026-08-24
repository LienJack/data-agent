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

const FALCON24_METHOD_CONTRACTS = Object.freeze({
  "falcon24-business-review-18m": [
    "Treat order_id as the order grain for revenue, order count, buyers, frequency, and AOV; never sum order_total once per item row.",
    "Use exactly the 18 ordered calendar months 2023-05 through 2024-10 and identify the minimum absolute month-over-month revenue change. Report percent_change as the decimal ratio (current - previous) / previous, not percentage points.",
    "Close revenue = active_buyers * orders_per_buyer * average_order_value for every month.",
    "For the worst month transition, use exactly six factor inputs B0, B1, F0, F1, A0, A1. For each of all six permutations, start with current = {'B':B0,'F':F0,'A':A0}, replace one factor at a time, and calculate each product inline as current['B'] * current['F'] * current['A']; do not pass the uppercase-key factor dict through **kwargs. Add new_product - previous_product to that factor and average each factor total over six. Set observed_revenue_change = B1*F1*A1 - B0*F0*A0 and require closure_error <= 0.01. Helper definitions and calls must use the same six-argument signature.",
    "For customer segment and payment method, compute member revenue on deduplicated orders; for product category, allocate each order_total across its item rows in proportion to nonnegative quantity, using equal shares when total quantity is zero. Return exactly the most negative revenue-change member for each of the three dimensions, breaking ties lexicographically.",
  ],
  "falcon24-delivery-experience-12m": [
    "Deduplicate to one row per order_id before delivery summaries or modeling; reject conflicting order-level values.",
    "Compare 2023-11 through 2024-04 with 2024-05 through 2024-10 and use linear interpolation quantiles for p50 and p90.",
    "Define low_rating as rating <= 2 and delayed as delivery_status != 'On Time'; fit a binomial-logit GLM on rated orders.",
    "The GLM design is intercept + delayed + log1p(order_total) + categorical month + product_category + customer_segment, with lexicographically first level as reference; report the delayed coefficient and two-sided Wald p-value, and set adjusted_binomial_glm.controls to include exactly the semantic control identifiers month, log_order_amount, product_category, and customer_segment.",
    "For low-rating scenarios, use the lexicographically first product category per order, rank all category/segment/status groups by low-rating count descending, then rate descending, order count descending, and key ascending; return the first five or all groups when fewer exist.",
    "Write conclusion in Chinese association language, include the exact word 关联, and never use 导致, 证明...影响, 驱动了, or any causal description for the delayed coefficient.",
  ],
  "falcon24-inventory-damage-12m": [
    "Use blinkit_inventory only for the primary damage calculation; blinkit_inventoryNew is sensitivity evidence and must not be combined with primary values.",
    "For every product, sort the 12 rows by month ascending and compute monthly damage_rate = damaged_stock / stock_received, using zero when stock_received is zero. Compute Theil-Sen on zero-based month positions x=0..11, not timestamp ordinals: collect every (rate[j]-rate[i])/(j-i) for i<j (66 slopes for a complete series), sort them, and take the linearly interpolated p50 (the arithmetic mean of the two middle values for 66 slopes).",
    "Compute the two-sided Mann-Kendall trend p-value for all products with this exact contract: S is the sum of sign(rate[j]-rate[i]) over every i<j; Var(S) = (n*(n-1)*(2*n+5) - sum_t(t*(t-1)*(2*t+5)))/18 where t are exact-value tie-group sizes; return p=1 when Var(S)<=0 or S=0, otherwise z=(S-1)/sqrt(Var(S)) for S>0 and z=(S+1)/sqrt(Var(S)) for S<0, then p=2*(1-Phi(abs(z))) using Phi(x)=0.5*(1+erf(x/sqrt(2))). Do not use scipy.stats.kendalltau or an asymptotic formula without this continuity and tie correction. Then compute Benjamini-Hochberg q-values before candidate filtering across the full product family: sort (product_id,p) by p ascending then product_id ascending, calculate p*n/rank for 1-based rank, traverse ranks n..1 taking the running minimum capped at 1, and map the resulting q-value back to each product_id.",
    "Return full finite floating-point values for damage rates, Theil-Sen slopes, raw p-values, and BH q-values; do not round or format any numeric output before context.write_json.",
    "High sales means total product sales is at least the within-category product-sales p75 using linear interpolation.",
    "Return every product satisfying high sales, positive Theil-Sen slope, and last-3 mean damage rate greater than previous-9 mean; classify PRIORITY iff BH q <= 0.05, otherwise WATCHLIST.",
  ],
  "falcon24-marketing-lag-effect": [
    "Build the complete 79-week calendar from Monday 2023-05-01 through Monday 2024-10-28. Set output.window to exactly {start:'2023-05-01', end_exclusive:'2024-11-01', week_count:79, grain:'WEEK'}; end_exclusive is the governed analysis boundary, not the day after the final Monday. First build one shared business_by_week series for order_revenue, new_customers, and order_count, asserting that duplicate input rows for a week agree. Analyze only distinct (channel,target_audience) tuples observed in the input; do not manufacture a Cartesian product. At that observed group grain, zero-fill only missing marketing measures (impressions, clicks, conversions, campaign_revenue, spend); every group-week must retain the shared business_by_week outcomes rather than replacing them with zero. Then compute funnel totals, CTR, conversion rate, and ROAS.",
    "For each business outcome in the exact order order_revenue, new_customers, order_count and each lag L from 0 through 4, regress response business_outcome[L:79] on predictor spend[0:79-L] with intercept, absolute week index L..78, sin(2*pi*absolute_week/52), and cos(2*pi*absolute_week/52). Initialize coefficient, raw-p, and BH-q result maps for all three outcomes before any loop. Set the top-level controls array to exactly ['trend','seasonality'] to bind the fitted linear-trend and sine/cosine seasonal controls to their semantic evidence identifiers.",
    "Compute the spend coefficient two-sided p-value using Newey-West HAC covariance with Bartlett weights, maxlags=4, and finite-sample factor n/(n-k), where k=5 design columns. Use the normal z distribution after HAC correction, not a Student t distribution. A statsmodels implementation must use cov_type='HAC', cov_kwds={'maxlags':4,'use_correction':True}, and use_t=False; report the spend coefficient and its resulting two-sided normal p-value.",
    "For each business outcome independently, select the lag with the smallest HAC p-value, breaking ties toward the smaller lag; apply Benjamini-Hochberg correction to selected p-values across all channel/audience groups for that same outcome.",
    "Classify each business outcome as GROWTH_ASSOCIATION iff coefficient > 0 and q <= 0.05; classify it as SPEND_WITHOUT_IMPROVEMENT iff the OLS slope of spend over week is positive and that outcome is not GROWTH_ASSOCIATION; otherwise NO_CLEAR_ASSOCIATION. Classify the channel/audience group as GROWTH_ASSOCIATION iff any of its three outcomes has that finding, otherwise SPEND_WITHOUT_IMPROVEMENT iff spend slope is positive, otherwise NO_CLEAR_ASSOCIATION. Use association language only.",
  ],
  "falcon24-cohort-retention-m0-m6": [
    "Return every registration_cohort and customer_segment group with exactly M0 through M6 in order.",
    "At each point compute retention = active_customers/cohort_size, repeat purchase = repeat_customers/cohort_size, average spend = revenue/active_customers or null when inactive, plus delivery and rating means.",
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
