import { buildFalcon24AgentAnalysisAcceptanceSuite } from "@data-agent/evals";
import { describe, expect, it } from "vitest";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  materializeFalcon24Arrow,
} from "../../src/evals/falcon24-analysis-queries.js";
import {
  falcon24ArrowBackedAnalysisOracleInternals,
  verifyFalcon24ArrowBackedOutput,
} from "../../src/evals/falcon24-arrow-backed-analysis-oracle.js";

const { verifiers } = falcon24ArrowBackedAnalysisOracleInternals;

describe("Falcon24 Arrow-backed analysis oracle", () => {
  it("issues only a v2 receipt bound to Arrow, materialization, evidence, and output hashes", async () => {
    const spec = FALCON24_ANALYSIS_QUERY_SPECS["falcon24-business-review-18m"];
    const months = Array.from({ length: 18 }, (_, index) =>
      new Date(Date.UTC(2023, 4 + index, 1)).toISOString().slice(0, 10),
    );
    const rows = Array.from({ length: spec.expected_rows }, (_, index) => {
      const orderDate = months[index % months.length] ?? "";
      return {
        order_id: `order-${index}`,
        order_date: orderDate,
        order_total: orderDate === months.at(-1) ? 1 : 10,
        payment_method: "cash",
        customer_id: `customer-${index}`,
        customer_segment: "regular",
        product_category: "grocery",
        quantity: 1,
      };
    });
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const month = row.order_date.slice(0, 7);
      grouped.set(month, [...(grouped.get(month) ?? []), row]);
    }
    const monthlyKpis = [...grouped].map(([month, selected]) => {
      const revenue = selected.reduce((sum, row) => sum + row.order_total, 0);
      return {
        month,
        revenue,
        order_count: selected.length,
        average_order_value: revenue / selected.length,
        active_buyers: selected.length,
        orders_per_buyer: 1,
      };
    });
    const previous = monthlyKpis.at(-2);
    const current = monthlyKpis.at(-1);
    if (!previous || !current) throw new Error("fixture month missing");
    const change = current.revenue - previous.revenue;
    const suite = await buildFalcon24AgentAnalysisAcceptanceSuite();
    const testCase = suite.cases.find(({ case_id: caseId }) => caseId === spec.case_id);
    if (!testCase) throw new Error("fixture case missing");
    const output = {
      schema_version: "falcon24-business-review-output@1.0.0",
      case_id: spec.case_id,
      window: {
        start: "2023-05-01",
        end_exclusive: "2024-11-01",
        period_count: 18,
        grain: "MONTH",
      },
      monthly_kpis: monthlyKpis,
      worst_revenue_decline: {
        month: current.month,
        absolute_change: change,
        percent_change: change / previous.revenue,
      },
      shapley_decomposition: {
        start_month: previous.month,
        end_month: current.month,
        buyer_contribution: change,
        frequency_contribution: 0,
        aov_contribution: 0,
        observed_revenue_change: change,
        closure_error: 0,
      },
      segment_drivers: [
        { dimension: "customer_segment", member: "regular", revenue_change: change },
        { dimension: "product_category", member: "grocery", revenue_change: change },
        { dimension: "payment_method", member: "cash", revenue_change: change },
      ],
      method_evidence: Object.fromEntries(
        testCase.required_methods.map((methodId) => [methodId, { verified: true }]),
      ),
      conclusion: "购买人数与客单价共同变化。",
    };
    const reference = (artifact_type: string, character: string) => ({
      artifact_id: "10000000-0000-4000-8000-000000000001",
      artifact_type,
      app_id: "10000000-0000-4000-8000-000000000002",
      tenant_id: "10000000-0000-4000-8000-000000000003",
      environment: "test",
      run_id: "10000000-0000-4000-8000-000000000004",
      revision: 1,
      content_hash: `sha256:${character.repeat(64)}`,
    });
    const verified = await verifyFalcon24ArrowBackedOutput({
      test_case: testCase,
      governed_input: {
        name: spec.input_name,
        format: "ARROW",
        query_evidence_ref: reference("QueryEvidence", "a") as never,
        query_evidence_document: {},
        input_ref: reference("SandboxResult", "b") as never,
        materialization_receipt_ref: reference("AnalysisInputMaterializationReceipt", "c") as never,
        materialization_receipt_document: {},
        content: materializeFalcon24Arrow(spec, rows),
      },
      output,
    });
    expect(verified.receipt).toMatchObject({
      schema_version: "falcon24-analysis-oracle@2.0.0",
      oracle_kind: "ARROW_INPUT_RECOMPUTE",
      input_materialization_receipt_hash: `sha256:${"c".repeat(64)}`,
      query_evidence_hash: `sha256:${"a".repeat(64)}`,
    });
    expect(
      verified.receipt.method_receipts.every(
        ({ evidence_hash: evidenceHash }) => evidenceHash === verified.receipt.verification_hash,
      ),
    ).toBe(true);
  });

  it("recomputes business KPIs and segment deltas from input rows", () => {
    const rows = Array.from({ length: 18 }, (_, index) => {
      const date = new Date(Date.UTC(2023, 4 + index, 1)).toISOString().slice(0, 10);
      return {
        order_id: `order-${index}`,
        order_date: date,
        order_total: index === 17 ? 10 : 100 + index,
        payment_method: "cash",
        customer_id: `customer-${index}`,
        customer_segment: "regular",
        product_category: "grocery",
        quantity: 1,
      };
    });
    const monthly = rows.map((row) => ({
      month: row.order_date.slice(0, 7),
      revenue: row.order_total,
      order_count: 1,
      average_order_value: row.order_total,
      active_buyers: 1,
      orders_per_buyer: 1,
    }));
    const output = {
      monthly_kpis: monthly,
      worst_revenue_decline: {
        month: monthly[17]?.month,
        absolute_change: 10 - 116,
        percent_change: (10 - 116) / 116,
      },
      shapley_decomposition: {
        start_month: monthly[16]?.month,
        end_month: monthly[17]?.month,
        buyer_contribution: 0,
        frequency_contribution: 0,
        aov_contribution: -106,
        observed_revenue_change: -106,
        closure_error: 0,
      },
      segment_drivers: [
        { dimension: "customer_segment", member: "regular", revenue_change: -106 },
        { dimension: "product_category", member: "grocery", revenue_change: -106 },
        { dimension: "payment_method", member: "cash", revenue_change: -106 },
      ],
    };
    expect(() => verifiers["falcon24-business-review-18m"](rows, output as never)).not.toThrow();
    expect(() =>
      verifiers["falcon24-business-review-18m"](rows, {
        ...output,
        monthly_kpis: [{ ...monthly[0], revenue: 999 }, ...monthly.slice(1)],
      } as never),
    ).toThrow("FALCON24_Q1_REVENUE_MISMATCH");
  });

  it("recomputes delivery splits, rated sample, and low-rating scenarios", () => {
    const rows = [
      {
        order_id: "first",
        order_date: "2024-01-01",
        delivery_time_minutes: 10,
        delivery_status: "On Time",
        order_total: 20,
        customer_segment: "regular",
        product_category: "grocery",
        rating: 5,
        feedback_category: "positive",
        sentiment: "positive",
        distance_km: 1,
      },
      {
        order_id: "second",
        order_date: "2024-08-01",
        delivery_time_minutes: 30,
        delivery_status: "Significantly Delayed",
        order_total: 40,
        customer_segment: "regular",
        product_category: "grocery",
        rating: 1,
        feedback_category: "negative",
        sentiment: "negative",
        distance_km: 3,
      },
    ];
    const output = {
      six_vs_six: {
        first: { p50_minutes: 10, p90_minutes: 10, on_time_rate: 1, low_rating_rate: 0 },
        second: { p50_minutes: 30, p90_minutes: 30, on_time_rate: 0, low_rating_rate: 1 },
      },
      adjusted_binomial_glm: { sample_size: 2 },
      low_rating_scenarios: [
        {
          product_category: "grocery",
          customer_segment: "regular",
          delivery_status: "Significantly Delayed",
          order_count: 1,
          low_rating_rate: 1,
        },
      ],
    };
    expect(() =>
      verifiers["falcon24-delivery-experience-12m"](rows, output as never),
    ).not.toThrow();
    expect(() =>
      verifiers["falcon24-delivery-experience-12m"](rows, {
        ...output,
        adjusted_binomial_glm: { sample_size: 1 },
      } as never),
    ).toThrow("FALCON24_Q2_GLM_SAMPLE_MISMATCH");
  });

  it("recomputes inventory sales, category threshold, rates, and Theil-Sen slope", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      month: `2024-${String(index + 1).padStart(2, "0")}`,
      product_id: "p1",
      product_name: "Product",
      category: "grocery",
      sales_quantity: 10,
      stock_received: 100,
      damaged_stock: index,
      sensitivity_stock_received: null,
      sensitivity_damaged_stock: null,
    }));
    const output = {
      products: [
        {
          product_id: "p1",
          category: "grocery",
          sales_quantity: 120,
          category_sales_p75: 120,
          theil_sen_slope: 0.01,
          last3_damage_rate: 0.1,
          previous9_damage_rate: 0.04,
          raw_p_value: 0.01,
          bh_q_value: 0.01,
          status: "PRIORITY",
        },
      ],
    };
    expect(() => verifiers["falcon24-inventory-damage-12m"](rows, output as never)).not.toThrow();
    expect(() =>
      verifiers["falcon24-inventory-damage-12m"](rows, {
        products: [{ ...output.products[0], sales_quantity: 119 }],
      } as never),
    ).toThrow("FALCON24_Q3_SALES_MISMATCH");
  });

  it("recomputes marketing funnel totals and ratios for every group", () => {
    const rows = [
      {
        week_start: "2024-01-01",
        channel: "email",
        target_audience: "new",
        impressions: 100,
        clicks: 20,
        conversions: 4,
        spend: 10,
        campaign_revenue: 30,
        order_count: 5,
        active_customers: 4,
        order_revenue: 40,
        new_customers: 2,
      },
    ];
    const result = {
      channel: "email",
      target_audience: "new",
      impressions: 100,
      clicks: 20,
      conversions: 4,
      spend: 10,
      revenue_generated: 30,
      click_through_rate: 0.2,
      conversion_rate: 0.2,
      roas: 3,
      selected_lag_weeks: 1,
      lag_coefficient: 0.1,
      hac_p_value: 0.1,
      bh_q_value: 0.1,
      finding: "NO_CLEAR_ASSOCIATION",
    };
    expect(() =>
      verifiers["falcon24-marketing-lag-effect"](rows, {
        channel_audience_results: [result],
      } as never),
    ).not.toThrow();
    expect(() =>
      verifiers["falcon24-marketing-lag-effect"](rows, {
        channel_audience_results: [{ ...result, roas: 4 }],
      } as never),
    ).toThrow("FALCON24_Q4_ROAS_MISMATCH");
  });

  it("recomputes all M0-M6 cohort measures and anomaly counts", () => {
    const rows = Array.from({ length: 7 }, (_, monthIndex) => ({
      registration_cohort: "2023-05",
      customer_segment: "regular",
      month_index: monthIndex,
      cohort_size: 10,
      active_customers: 5,
      repeat_customers: 2,
      order_count: 7,
      revenue: 100,
      delivery_minutes: 20,
      average_rating: 4,
      valid_timeline_customers: 8,
      valid_active_customers: 4,
      valid_order_count: 6,
      valid_revenue: 80,
      orders_before_registration: 2556,
      customers_first_order_before_registration: 1438,
      valid_ordering_customers: 734,
      no_order_customers: 328,
    }));
    const points = rows.map((row) => ({
      month_index: row.month_index,
      retention_rate: 0.5,
      repeat_purchase_rate: 0.2,
      average_spend: 20,
      delivery_minutes: 20,
      average_rating: 4,
    }));
    const output = {
      anomaly_precheck: {
        orders_before_registration: 2556,
        customers_first_order_before_registration: 1438,
        valid_ordering_customers: 734,
        no_order_customers: 328,
      },
      cohorts: [{ registration_cohort: "2023-05", customer_segment: "regular", points }],
    };
    expect(() => verifiers["falcon24-cohort-retention-m0-m6"](rows, output as never)).not.toThrow();
    expect(() =>
      verifiers["falcon24-cohort-retention-m0-m6"](rows, {
        ...output,
        cohorts: [
          {
            ...output.cohorts[0],
            points: [{ ...points[0], retention_rate: 0.4 }, ...points.slice(1)],
          },
        ],
      } as never),
    ).toThrow("FALCON24_Q5_RETENTION_MISMATCH");
  });
});
