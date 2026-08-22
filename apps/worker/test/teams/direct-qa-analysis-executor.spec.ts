import { describe, expect, it } from "vitest";
import {
  classifyDirectQaIntent,
  directQaAnalysisInternals,
} from "../../src/teams/direct-qa-analysis-executor.js";

describe("direct Q&A analysis", () => {
  it.each([
    ["一共有多少张表", "TABLE_COUNT"],
    ["表之间的关联是如何", "RELATIONSHIPS"],
    ["销售数据的趋向", "SALES_TREND"],
    ["哪些异常数据分析一下", "SALES_ANOMALIES"],
    ["写一份关于销售数据的分析报告", "SALES_REPORT"],
    ["解释一下这个概念", "GENERAL"],
  ] as const)("routes %s without Root/Specialist", (question, expected) => {
    expect(classifyDirectQaIntent(question)).toBe(expected);
  });

  it("renders comparable trend facts and excludes sparse boundary months", () => {
    const answer = directQaAnalysisInternals.renderTrend([
      { month: "2016-09", order_count: 4, sales_amount_brl: 252.24, sales_mom_pct: null },
      { month: "2017-01", order_count: 800, sales_amount_brl: 138_488.04, sales_mom_pct: 100 },
      { month: "2017-11", order_count: 7_544, sales_amount_brl: 1_194_882.8, sales_mom_pct: 53.25 },
      {
        month: "2018-08",
        order_count: 6_512,
        sales_amount_brl: 1_022_425.32,
        sales_mom_pct: -4.14,
      },
      { month: "2018-10", order_count: 4, sales_amount_brl: 589.67, sales_mom_pct: -86.72 },
    ]);
    expect(answer).toContain("总体上升");
    expect(answer).toContain("2017-11");
    expect(answer).toContain("低覆盖月份");
  });
});
