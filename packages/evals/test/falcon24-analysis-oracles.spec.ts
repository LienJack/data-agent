import { describe, expect, it } from "vitest";
import { buildFalcon24AgentAnalysisAcceptanceSuite } from "../src/test-center/falcon24-agent-analysis-suite.js";
import {
  buildFalcon24AnalysisChartProjection,
  computeFalcon24AnalysisChartDatasetHash,
  falcon24AnalysisOutputJsonSchema,
  falcon24AnalysisOutputSchema,
  validateFalcon24AnalysisOutput,
} from "../src/test-center/falcon24-analysis-oracles.js";

function methodEvidence(methods: readonly string[]) {
  return Object.fromEntries(methods.map((method) => [method, { verified: true }]));
}

function monthSequence(startYear: number, startMonth: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const offset = startMonth - 1 + index;
    const year = startYear + Math.floor(offset / 12);
    const month = (offset % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

function outputFor(caseId: string, methods: readonly string[]) {
  const evidence = methodEvidence(methods);
  if (caseId === "falcon24-business-review-18m") {
    return {
      schema_version: "falcon24-business-review-output@1.0.0",
      case_id: caseId,
      window: {
        start: "2023-05-01",
        end_exclusive: "2024-11-01",
        period_count: 18,
        grain: "MONTH",
      },
      monthly_kpis: monthSequence(2023, 5, 18).map((month, index) => ({
        month,
        revenue: index === 9 ? 800 : 1_000,
        order_count: index === 9 ? 8 : 10,
        average_order_value: 100,
        active_buyers: index === 9 ? 8 : 10,
        orders_per_buyer: 1,
      })),
      worst_revenue_decline: { month: "2024-02", absolute_change: -200, percent_change: -0.2 },
      shapley_decomposition: {
        start_month: "2024-01",
        end_month: "2024-02",
        buyer_contribution: -200,
        frequency_contribution: 0,
        aov_contribution: 0,
        observed_revenue_change: -200,
        closure_error: 0,
      },
      segment_drivers: [
        { dimension: "customer_segment", member: "Premium", revenue_change: -80 },
        { dimension: "product_category", member: "Grocery", revenue_change: -70 },
        { dimension: "payment_method", member: "UPI", revenue_change: -50 },
      ],
      method_evidence: evidence,
      conclusion: "收入下降主要由购买人数减少构成。",
    };
  }
  if (caseId === "falcon24-delivery-experience-12m") {
    return {
      schema_version: "falcon24-delivery-output@1.0.0",
      case_id: caseId,
      window: {
        start: "2023-11-01",
        end_exclusive: "2024-11-01",
        period_count: 12,
        grain: "MONTH",
      },
      data_quality_precheck: {
        invalid_delivery_orders: 932,
        valid_delivery_orders: 2_127,
      },
      six_vs_six: {
        first: { p50_minutes: 30, p90_minutes: 55, on_time_rate: 0.9, low_rating_rate: 0.1 },
        second: { p50_minutes: 35, p90_minutes: 65, on_time_rate: 0.82, low_rating_rate: 0.14 },
      },
      adjusted_binomial_glm: {
        delayed_coefficient: 0.45,
        delayed_p_value: 0.01,
        sample_size: 3_059,
        controls: ["month", "log_order_amount", "product_category", "customer_segment"],
        finding: "POSITIVE_SIGNIFICANT",
      },
      low_rating_scenarios: [
        {
          product_category: "Grocery",
          customer_segment: "Premium",
          delivery_status: "Delayed",
          order_count: 80,
          low_rating_rate: 0.3,
        },
      ],
      method_evidence: evidence,
      claim_strength: "ASSOCIATION_ONLY",
      conclusion: "延迟与低评分存在统计关联，但不能据此判断因果。",
    };
  }
  if (caseId === "falcon24-inventory-damage-12m") {
    return {
      schema_version: "falcon24-inventory-output@1.0.0",
      case_id: caseId,
      window: {
        start: "2023-11-01",
        end_exclusive: "2024-11-01",
        period_count: 12,
        grain: "MONTH",
      },
      primary_source: "blinkit_inventory",
      sensitivity_source: "blinkit_inventoryNew",
      sensitivity_combined_with_primary: false,
      products: [
        {
          product_id: "P001",
          product_name: "Product 1",
          category: "Grocery",
          sales_quantity: 120,
          category_sales_p75: 100,
          theil_sen_slope: 0.01,
          last3_damage_rate: 1.2,
          previous9_damage_rate: 1.1,
          raw_p_value: 0.01,
          bh_q_value: 0.04,
          status: "PRIORITY",
          product_count: 2,
          candidate_count: 2,
          category_sales_percentile: 0.75,
          selection_rule: "SALES_GTE_P75_AND_SLOPE_GT_0_AND_LAST3_GT_PREVIOUS9",
        },
        {
          product_id: "P002",
          product_name: "Product 2",
          category: "Grocery",
          sales_quantity: 90,
          category_sales_p75: 100,
          theil_sen_slope: 0.01,
          last3_damage_rate: 0.08,
          previous9_damage_rate: 0.03,
          raw_p_value: 0.2,
          bh_q_value: 0.3,
          status: "WATCHLIST",
          product_count: 2,
          candidate_count: 2,
          category_sales_percentile: 0.75,
          selection_rule: "SALES_GTE_P75_AND_SLOPE_GT_0_AND_LAST3_GT_PREVIOUS9",
        },
      ],
      method_evidence: evidence,
      conclusion: "P001 同时满足高销量、持续恶化和 FDR 门槛，应优先排查。",
    };
  }
  if (caseId === "falcon24-marketing-lag-effect") {
    return {
      schema_version: "falcon24-marketing-output@2.0.0",
      case_id: caseId,
      window: { start: "2023-05-01", end_exclusive: "2024-11-01", week_count: 79, grain: "WEEK" },
      channel_audience_results: [
        {
          channel: "Social",
          target_audience: "Young",
          impressions: 10_000,
          clicks: 1_000,
          conversions: 100,
          spend: 500,
          revenue_generated: 1_000,
          click_through_rate: 0.1,
          conversion_rate: 0.1,
          roas: 2,
          business_outcomes: [
            {
              metric: "order_revenue",
              selected_lag_weeks: 2,
              lag_coefficient: 0.4,
              hac_p_value: 0.01,
              bh_q_value: 0.04,
              finding: "GROWTH_ASSOCIATION",
            },
            {
              metric: "new_customers",
              selected_lag_weeks: 1,
              lag_coefficient: 0.1,
              hac_p_value: 0.2,
              bh_q_value: 0.3,
              finding: "SPEND_WITHOUT_IMPROVEMENT",
            },
            {
              metric: "order_count",
              selected_lag_weeks: 0,
              lag_coefficient: -0.1,
              hac_p_value: 0.4,
              bh_q_value: 0.5,
              finding: "SPEND_WITHOUT_IMPROVEMENT",
            },
          ],
          group_finding: "GROWTH_ASSOCIATION",
        },
      ],
      controls: ["trend", "seasonality"],
      method_evidence: evidence,
      claim_strength: "ASSOCIATION_ONLY",
      conclusion: "投入增长与后续收入增长存在时间关联，不能解释为因果。",
    };
  }
  return {
    schema_version: "falcon24-cohort-output@1.0.0",
    case_id: "falcon24-cohort-retention-m0-m6",
    cohort_window: {
      first_cohort: "2023-05",
      last_cohort: "2024-04",
      cohort_count: 12,
      observation_months: 7,
    },
    anomaly_precheck: {
      orders_before_registration: 1_186,
      customers_first_order_before_registration: 767,
      valid_ordering_customers: 531,
      no_order_customers: 209,
      invalid_delivery_orders: 931,
    },
    primary_reliable: false,
    cohorts: monthSequence(2023, 5, 12).map((registration_cohort) => ({
      registration_cohort,
      customer_segment: "All",
      points: Array.from({ length: 7 }, (_, month_index) => ({
        month_index,
        retention_rate: Math.max(0, 0.8 - month_index * 0.1),
        repeat_purchase_rate: Math.max(0, 0.6 - month_index * 0.08),
        average_spend: 100,
        delivery_minutes: 35,
        average_rating: 4,
      })),
    })),
    sensitivity: {
      excluded_pre_registration_customers: 767,
      retained_no_order_customers: 209,
      conclusion_changed: true,
    },
    method_evidence: evidence,
    conclusion: "注册与订单时间异常使总体留存结论不可靠，应 HOLD 并以敏感性结果为限。",
  };
}

describe("Falcon24 independent analysis oracles", () => {
  it("publishes an exact per-case JSON schema for model-generated Python", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    for (const testCase of suite.cases) {
      const schema = falcon24AnalysisOutputJsonSchema(testCase.case_id);
      expect(schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(JSON.stringify(schema)).toContain(testCase.case_id);
    }
  });

  it("accepts all five case-specific output contracts and hashes their normalized outputs", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    const receipts = await Promise.all(
      suite.cases.map((testCase) =>
        validateFalcon24AnalysisOutput({
          test_case: testCase,
          output: outputFor(testCase.case_id, testCase.required_methods),
        }),
      ),
    );
    expect(receipts).toHaveLength(5);
    expect(new Set(receipts.map(({ output_hash }) => output_hash)).size).toBe(5);
    expect(new Set(receipts.map(({ chart_dataset_hash }) => chart_dataset_hash)).size).toBe(5);
  });

  it("projects one bounded chart dataset for every accepted case", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    for (const testCase of suite.cases) {
      const output = outputFor(testCase.case_id, testCase.required_methods);
      const projection = buildFalcon24AnalysisChartProjection(output);
      expect(projection.kind).toBe("CHART");
      expect(projection.table.rows.length).toBeGreaterThan(0);
      expect(projection.table.total_rows).toBe(projection.table.rows.length);
      if (testCase.case_id === "falcon24-cohort-retention-m0-m6") {
        const cohortOutput = falcon24AnalysisOutputSchema.parse(output);
        if (cohortOutput.case_id !== testCase.case_id)
          throw new TypeError("cohort fixture invalid");
        expect(projection.table.rows).toHaveLength(cohortOutput.cohorts.length * 7);
        expect(projection.y_keys).toEqual(["retention_rate_pct", "repeat_purchase_rate_pct"]);
      }
      await expect(computeFalcon24AnalysisChartDatasetHash(output)).resolves.toMatch(/^sha256:/u);
    }
  });

  it("rejects the retired single-outcome marketing contract", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    const testCase = suite.cases.find(
      ({ case_id: caseId }) => caseId === "falcon24-marketing-lag-effect",
    );
    if (!testCase) throw new TypeError("marketing acceptance case missing");
    const current = falcon24AnalysisOutputSchema.parse(
      outputFor(testCase.case_id, testCase.required_methods),
    );
    if (current.case_id !== "falcon24-marketing-lag-effect") {
      throw new TypeError("marketing output fixture mismatched");
    }
    const result = current.channel_audience_results[0];
    if (!result) throw new TypeError("marketing output fixture missing");

    expect(
      falcon24AnalysisOutputSchema.safeParse({
        ...current,
        schema_version: "falcon24-marketing-output@1.0.0",
        channel_audience_results: [
          {
            ...result,
            business_outcomes: undefined,
            group_finding: undefined,
            selected_lag_weeks: 2,
            lag_coefficient: 0.4,
            hac_p_value: 0.01,
            bh_q_value: 0.04,
            finding: "GROWTH_ASSOCIATION",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects causal overclaim, unclosed Shapley, invalid inventory priority, and bad cohort audit", async () => {
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    const byId = new Map(suite.cases.map((testCase) => [testCase.case_id, testCase]));
    const q1 = byId.get("falcon24-business-review-18m");
    const q2 = byId.get("falcon24-delivery-experience-12m");
    const q3 = byId.get("falcon24-inventory-damage-12m");
    const q5 = byId.get("falcon24-cohort-retention-m0-m6");
    if (!q1 || !q2 || !q3 || !q5) throw new Error("test case missing");
    const q1Output = falcon24AnalysisOutputSchema.parse(outputFor(q1.case_id, q1.required_methods));
    if (q1Output.case_id !== "falcon24-business-review-18m") throw new Error("wrong fixture");
    await expect(
      validateFalcon24AnalysisOutput({
        test_case: q1,
        output: {
          ...q1Output,
          shapley_decomposition: { ...q1Output.shapley_decomposition, buyer_contribution: -100 },
        },
      }),
    ).rejects.toThrow("FALCON24_Q1_SHAPLEY_NOT_CLOSED");
    await expect(
      validateFalcon24AnalysisOutput({
        test_case: q2,
        output: {
          ...outputFor(q2.case_id, q2.required_methods),
          conclusion: "配送延迟导致了低评分。",
        },
      }),
    ).rejects.toThrow("FALCON24_ORACLE_CAUSAL_LANGUAGE_REJECTED");
    const q3Output = falcon24AnalysisOutputSchema.parse(outputFor(q3.case_id, q3.required_methods));
    if (q3Output.case_id !== "falcon24-inventory-damage-12m") throw new Error("wrong fixture");
    await expect(
      validateFalcon24AnalysisOutput({
        test_case: q3,
        output: {
          ...q3Output,
          products: q3Output.products.map((product) => ({
            ...product,
            status: "WATCHLIST" as const,
          })),
        },
      }),
    ).rejects.toThrow("FALCON24_Q3_PRIORITY_CLASSIFICATION_INVALID");
    const q5Output = falcon24AnalysisOutputSchema.parse(outputFor(q5.case_id, q5.required_methods));
    if (q5Output.case_id !== "falcon24-cohort-retention-m0-m6") throw new Error("wrong fixture");
    await expect(
      validateFalcon24AnalysisOutput({
        test_case: q5,
        output: {
          ...q5Output,
          anomaly_precheck: { ...q5Output.anomaly_precheck, orders_before_registration: 0 },
        },
      }),
    ).rejects.toThrow("FALCON24_Q5_QUALITY_AUDIT_INVALID");
  });
});
