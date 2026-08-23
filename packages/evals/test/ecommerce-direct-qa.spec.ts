import { describe, expect, it } from "vitest";
import {
  classifyEcommerceDirectQaIntent,
  compileEcommerceMonthlyOrderTrendSql,
  compileEcommerceSalesAnomalySql,
  compileEcommerceSalesReportSummarySql,
  ECOMMERCE_DIRECT_QA_CAPABILITY,
  matchesEcommerceDirectQaRegistration,
  renderEcommerceTrend,
} from "../src/ecommerce-direct-qa/index.js";

describe("E-commerce direct Q&A capability", () => {
  it.each([
    ["一共有多少张表", "TABLE_COUNT"],
    ["销售数据的趋向", "SALES_TREND"],
    ["哪些异常数据分析一下", "SALES_ANOMALIES"],
    ["写一份关于销售数据的分析报告", "SALES_REPORT"],
    ["解释一下这个概念", null],
  ] as const)("classifies %s inside the capability", (question, expected) => {
    expect(classifyEcommerceDirectQaIntent(question)).toBe(expected);
  });

  it("matches only the registered workspace, datasource, release and profile", () => {
    const registration = {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      benchmark_profile_id: ECOMMERCE_DIRECT_QA_CAPABILITY.benchmark_profile_id,
    };
    const applicable = {
      workspace_id: registration.workspace_id,
      datasource_id: ECOMMERCE_DIRECT_QA_CAPABILITY.datasource_id,
      semantic_release_id: ECOMMERCE_DIRECT_QA_CAPABILITY.semantic_release_id,
    };
    expect(matchesEcommerceDirectQaRegistration(registration, applicable)).toBe(true);
    expect(
      matchesEcommerceDirectQaRegistration(registration, {
        ...applicable,
        workspace_id: "00000000-0000-4000-8000-000000000002",
      }),
    ).toBe(false);
    expect(
      matchesEcommerceDirectQaRegistration(
        { ...registration, benchmark_profile_id: "unregistered" },
        applicable,
      ),
    ).toBe(false);
  });

  it("owns the fixed SQL and presentation rules", () => {
    expect(compileEcommerceMonthlyOrderTrendSql()).toContain("demo_adb_ecommerce_mart.fact_order");
    expect(compileEcommerceSalesAnomalySql()).toContain("MONTHLY_SALES_CHANGE");
    expect(compileEcommerceSalesReportSummarySql()).toContain("average_review_score");
    expect(
      renderEcommerceTrend([
        { month: "2016-09", order_count: 4, sales_amount_brl: 252.24, sales_mom_pct: null },
        { month: "2017-01", order_count: 800, sales_amount_brl: 138_488.04, sales_mom_pct: 100 },
        {
          month: "2017-11",
          order_count: 7_544,
          sales_amount_brl: 1_194_882.8,
          sales_mom_pct: 53.25,
        },
        {
          month: "2018-08",
          order_count: 6_512,
          sales_amount_brl: 1_022_425.32,
          sales_mom_pct: -4.14,
        },
        { month: "2018-10", order_count: 4, sales_amount_brl: 589.67, sales_mom_pct: -86.72 },
      ]),
    ).toContain("低覆盖月份");
  });
});
