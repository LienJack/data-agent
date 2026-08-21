import type { ArtifactPreviewResultV2 } from "@data-agent/contracts";
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
});
