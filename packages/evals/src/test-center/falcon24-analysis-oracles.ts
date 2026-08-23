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
  schema_version: z.literal("falcon24-delivery-output@1.0.0"),
  case_id: z.literal("falcon24-delivery-experience-12m"),
  window: fullMonthWindowSchema,
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
  adjusted_binomial_glm: z.strictObject({
    delayed_coefficient: finite,
    delayed_p_value: probability,
    sample_size: z.number().int().positive(),
    controls: z.array(z.string()).min(4),
  }),
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
      category: z.string().min(1),
      sales_quantity: nonnegative,
      category_sales_p75: nonnegative,
      theil_sen_slope: finite,
      last3_damage_rate: probability,
      previous9_damage_rate: probability,
      raw_p_value: probability,
      bh_q_value: probability,
      status: z.enum(["PRIORITY", "WATCHLIST"]),
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

const cohortPointSchema = z.strictObject({
  month_index: z.number().int().min(0).max(6),
  retention_rate: probability,
  repeat_purchase_rate: probability,
  average_spend: nonnegative.nullable(),
  delivery_minutes: nonnegative.nullable(),
  average_rating: finite.min(1).max(5).nullable(),
});

const cohortSchema = z.strictObject({
  schema_version: z.literal("falcon24-cohort-output@1.0.0"),
  case_id: z.literal("falcon24-cohort-retention-m0-m6"),
  cohort_window: z.strictObject({
    first_cohort: month,
    last_cohort: month,
    cohort_count: z.number().int().positive(),
    observation_months: z.literal(7),
  }),
  anomaly_precheck: z.strictObject({
    orders_before_registration: z.number().int().nonnegative(),
    customers_first_order_before_registration: z.number().int().nonnegative(),
    valid_ordering_customers: z.number().int().nonnegative(),
    no_order_customers: z.number().int().nonnegative(),
  }),
  primary_reliable: z.literal(false),
  cohorts: z
    .array(
      z.strictObject({
        registration_cohort: month,
        customer_segment: z.string().min(1),
        points: z.array(cohortPointSchema).length(7),
      }),
    )
    .min(12),
  sensitivity: z.strictObject({
    excluded_pre_registration_customers: z.number().int().nonnegative(),
    retained_no_order_customers: z.number().int().nonnegative(),
    conclusion_changed: z.boolean(),
  }),
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
  if (
    output.six_vs_six.first.p90_minutes < output.six_vs_six.first.p50_minutes ||
    output.six_vs_six.second.p90_minutes < output.six_vs_six.second.p50_minutes
  ) {
    throw new TypeError("FALCON24_Q2_QUANTILES_INVALID");
  }
  const controls = new Set(output.adjusted_binomial_glm.controls);
  for (const control of ["month", "log_order_amount", "product_category", "customer_segment"]) {
    if (!controls.has(control)) throw new TypeError("FALCON24_Q2_GLM_CONTROL_MISSING");
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
  if (
    output.cohort_window.first_cohort !== "2023-05" ||
    output.cohort_window.last_cohort !== "2024-04" ||
    output.cohort_window.cohort_count !== 12
  ) {
    throw new TypeError("FALCON24_Q5_COHORT_WINDOW_INVALID");
  }
  const quality = output.anomaly_precheck;
  if (
    quality.orders_before_registration !== 2_556 ||
    quality.customers_first_order_before_registration !== 1_438 ||
    quality.valid_ordering_customers !== 734 ||
    quality.no_order_customers !== 328 ||
    output.sensitivity.excluded_pre_registration_customers !== 1_438 ||
    output.sensitivity.retained_no_order_customers !== 328
  ) {
    throw new TypeError("FALCON24_Q5_QUALITY_AUDIT_INVALID");
  }
  for (const cohort of output.cohorts) {
    if (cohort.points.some((point, index) => point.month_index !== index)) {
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
  return Object.freeze({ output, output_hash: outputHash });
}

export const falcon24AnalysisOracleInternals = Object.freeze({ evaluators });
