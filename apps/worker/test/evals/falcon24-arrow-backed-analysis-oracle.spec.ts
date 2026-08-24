import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts";
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

const {
  fitDeliveryGlm,
  mannKendallP,
  normalCdf,
  olsHac,
  quantile,
  shapleyThreeFactor,
  verifyOperatorAuthority,
  verifiers,
} = falcon24ArrowBackedAnalysisOracleInternals;

describe("Falcon24 Arrow-backed analysis oracle", () => {
  it("matches the semantic normal-CDF contract at multiple tails", () => {
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 14);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517796, 14);
    expect(normalCdf(3)).toBeCloseTo(0.9986501019683699, 14);
    expect(mannKendallP(Array.from({ length: 12 }, (_, index) => index))).toBeCloseTo(
      0.000008303107353668793,
      14,
    );
  });

  it("issues only a v4 receipt bound to Arrow, operator, evidence, and output hashes", async () => {
    const spec = FALCON24_ANALYSIS_QUERY_SPECS["falcon24-business-review-18m"];
    const months = Array.from({ length: 18 }, (_, index) =>
      new Date(Date.UTC(2023, 4 + index, 1)).toISOString().slice(0, 10),
    );
    const rows = Array.from({ length: spec.expected_rows }, (_, index) => {
      const orderDate = months[index % months.length] ?? "";
      return {
        order_id: `order-${index}`,
        order_date: orderDate,
        payment_method: "cash",
        customer_id: `customer-${index}`,
        customer_segment: "regular",
        product_category: "grocery",
        quantity: 1,
        order_total: orderDate === months.at(-1) ? 1 : 10,
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
    const [buyerContribution, frequencyContribution, aovContribution] = shapleyThreeFactor(
      [previous.active_buyers, previous.orders_per_buyer, previous.average_order_value],
      [current.active_buyers, current.orders_per_buyer, current.average_order_value],
    );
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
        buyer_contribution: buyerContribution,
        frequency_contribution: frequencyContribution,
        aov_contribution: aovContribution,
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
    const operatorObligation = {
      call_id: "q1_revenue_identity",
      operator_id: "decomposition.product-shapley-exact@1",
      result_binding: {
        result_output_name: "result",
        result_collection_path: "/method_evidence/buyers-frequency-aov-shapley/contributions",
        operator_collection_path: "/contributions",
        label_fields: ["label", "factor"],
        value_bindings: [
          {
            result_field: "contribution",
            operator_field: "contribution",
            comparison: "EXACT",
            absolute_tolerance: 0,
            relative_tolerance: 0,
          },
        ],
        require_exact_label_set: true,
      },
    } as const;
    const operatorReceipt = {
      schema_version: "statistical-operator-call-receipt@1.0.0",
      call_id: operatorObligation.call_id,
      operator_id: operatorObligation.operator_id,
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      implementation_digest: `sha256:${"d".repeat(64)}`,
      resolved_parameters: {
        mode: "exact",
        max_factors: 8,
        closure_tolerance: 1e-9,
      },
      resolved_parameters_hash: `sha256:${"e".repeat(64)}`,
      input_hash: `sha256:${"f".repeat(64)}`,
      output_hash: `sha256:${"1".repeat(64)}`,
      result_binding_hash: `sha256:${"3".repeat(64)}`,
      sample_size: 1,
      group_count: 1,
      family_size: null,
      rank: null,
      applicability: "PASS",
      limitation_codes: ["APPROXIMATE_MODE_NOT_SUPPORTED", "PRODUCT_IDENTITY_REQUIRED"],
    } as const;
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
      sandbox_receipt: {
        status: "SUCCEEDED",
        failure_code: null,
        generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        operator_obligations: [operatorObligation],
        operator_receipts: [operatorReceipt],
        operator_receipt_closure_hash: `sha256:${"4".repeat(64)}`,
      } as never,
      output,
    });
    expect(verified.receipt).toMatchObject({
      schema_version: "falcon24-analysis-oracle@4.0.0",
      oracle_kind: "ARROW_INPUT_RECOMPUTE",
      input_materialization_receipt_hash: `sha256:${"c".repeat(64)}`,
      query_evidence_hash: `sha256:${"a".repeat(64)}`,
      operator_receipt_closure_hash: `sha256:${"4".repeat(64)}`,
    });
    expect(
      verified.receipt.method_receipts.every(
        ({ evidence_hash: evidenceHash }) => evidenceHash === verified.receipt.verification_hash,
      ),
    ).toBe(true);
    expect(() =>
      verifyOperatorAuthority({
        test_case: testCase,
        sandbox_receipt: {
          status: "SUCCEEDED",
          failure_code: null,
          generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
          operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
          operator_obligations: [operatorObligation],
          operator_receipts: [
            {
              ...operatorReceipt,
              resolved_parameters: { ...operatorReceipt.resolved_parameters, max_factors: 7 },
            },
          ],
          operator_receipt_closure_hash: `sha256:${"4".repeat(64)}`,
        } as never,
      }),
    ).toThrow("FALCON24_ORACLE_OPERATOR_RECEIPT_INVALID");
    expect(() =>
      verifyOperatorAuthority({
        test_case: testCase,
        sandbox_receipt: {
          status: "SUCCEEDED",
          failure_code: null,
          generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
          operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
          operator_obligations: [operatorObligation],
          operator_receipts: [],
          operator_receipt_closure_hash: `sha256:${"4".repeat(64)}`,
        } as never,
      }),
    ).toThrow("FALCON24_ORACLE_OPERATOR_AUTHORITY_INVALID");
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
    const rows = Array.from({ length: 72 }, (_, index) => {
      const orderDate = new Date(Date.UTC(2023, 10 + Math.floor(index / 6), 1))
        .toISOString()
        .slice(0, 10);
      const delayed = index % 3 === 0;
      const lowRating = (index * 7 + Math.floor(index / 3)) % 11 < 3;
      return {
        order_id: `order-${index}`,
        order_date: orderDate,
        delivery_time_minutes: delayed ? 34 + (index % 5) : 16 + (index % 7),
        delivery_status: delayed ? "Significantly Delayed" : "On Time",
        order_total: 20 + (index % 7),
        customer_segment: "regular",
        product_category: "grocery",
        rating: lowRating ? 1 : 4,
        feedback_category: lowRating ? "negative" : "positive",
        sentiment: lowRating ? "negative" : "positive",
        distance_km: 1 + (index % 4),
        invalid_delivery_orders: 0,
      };
    });
    const summarize = (selected: typeof rows) => ({
      p50_minutes: quantile(
        selected.map(({ delivery_time_minutes }) => delivery_time_minutes),
        0.5,
      ),
      p90_minutes: quantile(
        selected.map(({ delivery_time_minutes }) => delivery_time_minutes),
        0.9,
      ),
      on_time_rate:
        selected.filter(({ delivery_status }) => delivery_status === "On Time").length /
        selected.length,
      low_rating_rate: selected.filter(({ rating }) => rating <= 2).length / selected.length,
    });
    const glm = fitDeliveryGlm(rows);
    const scenarioGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      scenarioGroups.set(row.delivery_status, [
        ...(scenarioGroups.get(row.delivery_status) ?? []),
        row,
      ]);
    }
    const scenarios = [...scenarioGroups]
      .map(([deliveryStatus, selected]) => ({
        product_category: "grocery",
        customer_segment: "regular",
        delivery_status: deliveryStatus,
        order_count: selected.length,
        low_rating_rate: selected.filter(({ rating }) => rating <= 2).length / selected.length,
        lowRatings: selected.filter(({ rating }) => rating <= 2).length,
      }))
      .sort(
        (left, right) =>
          right.lowRatings - left.lowRatings ||
          right.low_rating_rate - left.low_rating_rate ||
          right.order_count - left.order_count ||
          `${left.product_category}\u0000${left.customer_segment}\u0000${left.delivery_status}`.localeCompare(
            `${right.product_category}\u0000${right.customer_segment}\u0000${right.delivery_status}`,
          ),
      )
      .map(({ lowRatings: _lowRatings, ...scenario }) => scenario);
    const output = {
      data_quality_precheck: {
        invalid_delivery_orders: 0,
        valid_delivery_orders: rows.length,
      },
      six_vs_six: {
        first: summarize(rows.filter(({ order_date }) => order_date < "2024-05-01")),
        second: summarize(rows.filter(({ order_date }) => order_date >= "2024-05-01")),
      },
      adjusted_binomial_glm: {
        delayed_coefficient: glm.coefficient,
        delayed_p_value: glm.pValue,
        sample_size: rows.length,
        finding: glm.pValue > 0.05 ? "NOT_SIGNIFICANT" : "POSITIVE_SIGNIFICANT",
      },
      low_rating_scenarios: scenarios,
    };
    expect(() =>
      verifiers["falcon24-delivery-experience-12m"](rows, output as never),
    ).not.toThrow();
    expect(() =>
      verifiers["falcon24-delivery-experience-12m"](rows, {
        ...output,
        adjusted_binomial_glm: { ...output.adjusted_binomial_glm, sample_size: 1 },
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
    const rawPValue = mannKendallP(rows.map(({ damaged_stock }) => damaged_stock / 100));
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
          raw_p_value: rawPValue,
          bh_q_value: rawPValue,
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
    const spendSeries = Array.from(
      { length: 79 },
      (_, index) => 20 + 0.3 * index + 4 * Math.sin(index * 0.7) + (index % 5),
    );
    const rows = Array.from({ length: 79 }, (_, index) => {
      const impressions = 100 + index;
      const clicks = 20 + (index % 11);
      const conversions = 4 + (index % 3);
      return {
        week_start: new Date(Date.UTC(2023, 4, 1 + index * 7)).toISOString().slice(0, 10),
        channel: "email",
        target_audience: "new",
        impressions,
        clicks,
        conversions,
        spend: spendSeries[index] ?? 0,
        campaign_revenue: conversions * 8,
        order_count: 50 + index,
        active_customers: 40 + index,
        order_revenue:
          200 +
          0.5 * index +
          8 * Math.sin((2 * Math.PI * index) / 52) +
          1.5 * (spendSeries[Math.max(0, index - 2)] ?? 0) +
          Math.cos(index * 1.3),
        new_customers: 2 + (index % 5),
      };
    });
    const selectedFor = (metric: "order_revenue" | "new_customers" | "order_count") => {
      const candidates = Array.from({ length: 5 }, (_, lag) => ({
        lag,
        ...olsHac({
          design: rows.slice(lag).map((_row, offset) => {
            const index = offset + lag;
            return [
              1,
              spendSeries[index - lag] ?? 0,
              index,
              Math.sin((2 * Math.PI * index) / 52),
              Math.cos((2 * Math.PI * index) / 52),
            ];
          }),
          response: rows.slice(lag).map((row) => row[metric]),
          coefficient_index: 1,
          max_lag: 4,
        }),
      })).sort((left, right) => left.pValue - right.pValue || left.lag - right.lag);
      const selected = candidates[0];
      if (!selected) throw new TypeError(`marketing fixture missing selected lag:${metric}`);
      return selected;
    };
    const sum = (key: "impressions" | "clicks" | "conversions" | "spend" | "campaign_revenue") =>
      rows.reduce((total, row) => total + row[key], 0);
    const impressions = sum("impressions");
    const clicks = sum("clicks");
    const conversions = sum("conversions");
    const spend = sum("spend");
    const revenue = sum("campaign_revenue");
    const business_outcomes = (["order_revenue", "new_customers", "order_count"] as const).map(
      (metric) => {
        const selected = selectedFor(metric);
        return {
          metric,
          selected_lag_weeks: selected.lag,
          lag_coefficient: selected.coefficient,
          hac_p_value: selected.pValue,
          bh_q_value: selected.pValue,
          finding:
            selected.coefficient > 0 && selected.pValue <= 0.05
              ? ("GROWTH_ASSOCIATION" as const)
              : ("SPEND_WITHOUT_IMPROVEMENT" as const),
        };
      },
    );
    const result = {
      channel: "email",
      target_audience: "new",
      impressions,
      clicks,
      conversions,
      spend,
      revenue_generated: revenue,
      click_through_rate: clicks / impressions,
      conversion_rate: conversions / clicks,
      roas: revenue / spend,
      business_outcomes,
      group_finding: business_outcomes.some(({ finding }) => finding === "GROWTH_ASSOCIATION")
        ? "GROWTH_ASSOCIATION"
        : "SPEND_WITHOUT_IMPROVEMENT",
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
    const quality = {
      observation_end_month: "2024-10",
      orders_before_registration: 1,
      customers_first_order_before_registration: 1,
      valid_ordering_customers: 0,
      no_order_customers: 1,
      invalid_delivery_orders: 0,
    };
    const rows = [
      {
        customer_id: "c1",
        customer_type: "regular",
        registration_date: "2023-05-15",
        order_id: "pre-c1",
        event_date: "2023-04-30",
        delivery_minutes: 50,
        average_rating: 2,
        revenue: 5,
        ...quality,
      },
      {
        customer_id: "c1",
        customer_type: "regular",
        registration_date: "2023-05-15",
        order_id: "c1-m0-a",
        event_date: "2023-05-16",
        delivery_minutes: 30,
        average_rating: 4,
        revenue: 10,
        ...quality,
      },
      {
        customer_id: "c1",
        customer_type: "regular",
        registration_date: "2023-05-15",
        order_id: "c1-m0-b",
        event_date: "2023-05-17",
        delivery_minutes: 40,
        average_rating: 2,
        revenue: 20,
        ...quality,
      },
      {
        customer_id: "c2",
        customer_type: "regular",
        registration_date: "2023-05-20",
        order_id: null,
        event_date: null,
        delivery_minutes: null,
        average_rating: null,
        revenue: null,
        ...quality,
      },
    ];
    const points = Array.from({ length: 7 }, (_, monthIndex) => ({
      month_index: monthIndex,
      retention_rate: monthIndex === 0 ? 0.5 : 0,
      repeat_purchase_rate: monthIndex === 0 ? 0.5 : 0,
      average_spend: monthIndex === 0 ? 30 : null,
      delivery_minutes: monthIndex === 0 ? 35 : null,
      average_rating: monthIndex === 0 ? 3 : null,
    }));
    const output = {
      anomaly_precheck: {
        orders_before_registration: 1,
        customers_first_order_before_registration: 1,
        valid_ordering_customers: 0,
        no_order_customers: 1,
        invalid_delivery_orders: 0,
      },
      sensitivity: {
        excluded_pre_registration_customers: 1,
        retained_no_order_customers: 1,
        conclusion_changed: true,
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
