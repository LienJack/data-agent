import { describe, expect, it } from "vitest";
import { buildAnalysisNarrativeProjection } from "../../src/analysis/executor.js";
import {
  evaluatePanelPeriodComparison,
  projectPanelPeriodComparisonCharts,
} from "../../src/analysis/monthly-panel-period-comparison.js";

const columns = {
  time_output: "month",
  current_output: "current",
  comparison_output: "prior",
  category_output: "segment",
  rate_output: "rate",
  group_coverage: "BOTH_PERIOD_GROUPS" as const,
};
function rows() {
  return Array.from({ length: 12 }, (_, i) =>
    ["A", "B"].map((segment) => {
      const current =
        segment === "A"
          ? i === 7
            ? 50
            : i === 8
              ? 80
              : i === 9
                ? 90
                : 100
          : i === 7
            ? 100
            : i === 8
              ? 120
              : i === 9
                ? 150
                : 300;
      const prior = i < 6 ? null : segment === "A" ? 100 : 300;
      return {
        month: `2024-${String(i + 1).padStart(2, "0")}-01`,
        segment,
        current,
        prior,
        rate: prior === null ? null : (current - prior) / prior,
      };
    }),
  ).flat();
}
function rowAt<T>(input: readonly T[], index: number): T {
  const row = input[index];
  if (!row) throw new Error("TEST_ROW_REQUIRED");
  return row;
}
describe("complete panel year-over-year arithmetic", () => {
  it("retains four-category YoY facts ahead of auxiliary statistics within existing narrative budgets", () => {
    const input = rows().flatMap((row) => [row, { ...row, segment: `${row.segment}-second` }]);
    const periodComparison = evaluatePanelPeriodComparison(columns, input);
    const projection = buildAnalysisNarrativeProjection({
      data: {
        measure_1: { auxiliary: "x".repeat(7900) },
        measure_2: { auxiliary: "x".repeat(7900) },
        measure_3: { auxiliary: "x".repeat(7900) },
        period_comparison: periodComparison,
      },
    });
    expect(projection.fields.period_comparison).toEqual(periodComparison);
    expect(new TextEncoder().encode(JSON.stringify(projection)).byteLength).toBeLessThan(24 * 1024);
    expect(projection.fields.measure_3).toBeUndefined();
  });
  it("ranks overall YoY, not averaged group rates or adjacent-month drops", () => {
    const result = evaluatePanelPeriodComparison(columns, rows());
    expect(result.comparison_kind).toBe("YEAR_OVER_YEAR");
    expect(result.ranking_basis).toBe("TOTAL_YOY_RATE");
    expect(
      result.largest_declines.map((m) => [
        m.period,
        m.current_value,
        m.comparison_value,
        m.yoy_rate,
      ]),
    ).toEqual([
      ["2024-08-01", 150, 400, -0.625],
      ["2024-09-01", 200, 400, -0.5],
      ["2024-10-01", 240, 400, -0.4],
    ]);
    expect(result.largest_declines[0]?.groups).toEqual([
      {
        group: { segment: "A" },
        current_value: 50,
        comparison_value: 100,
        absolute_change: -50,
        yoy_rate: -0.5,
        contribution_to_total_growth: -0.125,
      },
      {
        group: { segment: "B" },
        current_value: 100,
        comparison_value: 300,
        absolute_change: -200,
        yoy_rate: -2 / 3,
        contribution_to_total_growth: -0.5,
      },
    ]);
    expect(
      result.months
        .slice(0, 6)
        .every((m) => m.comparison_value === null && m.yoy_rate === null && !m.ranking_eligible),
    ).toBe(true);
    expect(result.largest_declines[0]?.yoy_rate).not.toBe((-0.5 - 2 / 3) / 2);
  });
  it("projects the verified overall trend and complete worst-month groups for two governed charts", () => {
    const comparison = evaluatePanelPeriodComparison(columns, rows());
    const charts = projectPanelPeriodComparisonCharts(columns, comparison);
    expect(charts.overall_trend_rows).toHaveLength(12);
    expect(charts.overall_trend_rows[7]).toEqual({
      period: "2024-08-01",
      current_value: 150,
      comparison_value: 400,
      yoy_rate: -0.625,
    });
    expect(charts.largest_decline_group_rows).toHaveLength(6);
    expect(charts.largest_decline_group_rows[0]).toEqual({
      period: "2024-08-01",
      group_value: "A",
      current_value: 50,
      comparison_value: 100,
      yoy_rate: -0.5,
      contribution_to_total_growth: -0.125,
    });
    expect(charts.largest_decline_group_rows.at(-1)).toMatchObject({
      period: "2024-10-01",
      group_value: "B",
    });
  });
  it("does not treat a missing group value as zero or rank a partial total", () => {
    const input: Array<Record<string, unknown>> = rows();
    rowAt(input, 14).current = null;
    rowAt(input, 14).rate = null;
    const result = evaluatePanelPeriodComparison(columns, input);
    expect(result.months[7]).toMatchObject({
      current_value: null,
      comparison_value: 400,
      yoy_rate: null,
      ranking_eligible: false,
    });
    expect(result.largest_declines.map((m) => m.period)).toEqual(["2024-09-01", "2024-10-01"]);
  });
  it("keeps a zero-base group rate NULL but uses the valid overall denominator for contributions", () => {
    const input = rows();
    rowAt(input, 14).prior = 0;
    rowAt(input, 14).rate = null;
    const result = evaluatePanelPeriodComparison(columns, input);
    expect(result.largest_declines[0]).toMatchObject({
      period: "2024-08-01",
      yoy_rate: -0.5,
      groups: [
        { yoy_rate: null, absolute_change: 50, contribution_to_total_growth: 1 / 6 },
        { absolute_change: -200, contribution_to_total_growth: -2 / 3 },
      ],
    });
  });
  it.each([0, -1])("does not rank a non-positive overall base: %s", (value) => {
    const input = rows();
    for (const row of input)
      if (row.month === "2024-08-01") {
        row.prior = value;
        row.rate = value === 0 ? null : (row.current - value) / value;
      }
    const result = evaluatePanelPeriodComparison(columns, input);
    expect(result.months[7]?.ranking_eligible).toBe(false);
    expect(result.largest_declines.map((m) => m.period)).not.toContain("2024-08-01");
  });
  it("rejects finite-input overflow", () => {
    const input = rows();
    rowAt(input, 14).current = Number.MAX_VALUE;
    rowAt(input, 15).current = Number.MAX_VALUE;
    expect(() => evaluatePanelPeriodComparison(columns, input)).toThrow(
      "MONTHLY_PANEL_COMPARISON_NUMERIC_RANGE_INVALID",
    );
  });
});
