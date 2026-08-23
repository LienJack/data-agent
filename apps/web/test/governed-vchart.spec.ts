import type { ArtifactPreviewResultV2, ArtifactPreviewResultV3 } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { toGovernedVChartSpec } from "@/components/workbench/governed-vchart-spec";

function projection(chartType: "LINE" | "BAR" | "PIE"): ArtifactPreviewResultV2["projection"] {
  return {
    kind: "CHART",
    chart_type: chartType,
    title: "月度订单趋势",
    description: "受治理数据",
    unit: "单",
    x_key: "month",
    y_keys: ["order_count"],
    legend: { visible: chartType === "PIE" },
    table: {
      kind: "TABLE",
      columns: [
        { key: "month", label: "月份", data_type: "STRING" },
        { key: "order_count", label: "订单量", data_type: "NUMBER" },
      ],
      rows: [
        { month: "2026-01", order_count: 41 },
        { month: "2026-02", order_count: 73 },
      ],
      total_rows: 2,
    },
  };
}

describe("governed VChart spec mapper", () => {
  it.each([
    ["LINE", "line"],
    ["BAR", "bar"],
    ["PIE", "pie"],
  ] as const)("maps %s into the local %s chart allowlist", (chartType, expectedType) => {
    const spec = toGovernedVChartSpec(projection(chartType));
    expect(spec.type).toBe(expectedType);
    expect((spec as { readonly animation?: unknown }).animation).toBe(false);
    expect(JSON.stringify(spec)).not.toMatch(/<|https?:|javascript:/u);
    expect(Object.values(spec).some((value) => typeof value === "function")).toBe(false);
  });

  it.each([
    ["HORIZONTAL_BAR", "bar", "horizontal"],
    ["SIGNED_CONTRIBUTION", "bar", "horizontal"],
    ["SCATTER", "scatter", undefined],
    ["RELATIONSHIP", "scatter", undefined],
    ["PRIORITY_MATRIX", "scatter", undefined],
    ["FORECAST_INTERVAL", "rangeArea", undefined],
  ] as const)("maps V3 %s without executable chart expressions", (chartType, type, direction) => {
    const interval = chartType === "FORECAST_INTERVAL";
    const value: ArtifactPreviewResultV3["projection"] = {
      kind: "CHART",
      chart_type: chartType,
      title: "确定性分析",
      description: null,
      unit: "元",
      x_key: "period",
      y_keys: ["value"],
      lower_bound_key: interval ? "lower" : null,
      upper_bound_key: interval ? "upper" : null,
      series_key: null,
      legend: { visible: false },
      evidence_level: "L2_OBSERVATION",
      table: {
        kind: "TABLE",
        columns: [
          { key: "period", label: "周期", data_type: "STRING" },
          { key: "value", label: "值", data_type: "NUMBER" },
          { key: "lower", label: "下界", data_type: "NUMBER" },
          { key: "upper", label: "上界", data_type: "NUMBER" },
        ],
        rows: [{ period: "2026-01", value: -2, lower: -3, upper: -1 }],
        total_rows: 1,
      },
    };
    const spec = toGovernedVChartSpec(value);
    expect(spec.type).toBe(type);
    expect((spec as { direction?: string }).direction).toBe(direction);
    expect(JSON.stringify(spec)).not.toMatch(/function|javascript:|https?:/u);
  });
});
