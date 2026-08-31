import {
  type ArtifactPreviewResultV2,
  type ArtifactPreviewResultV3,
  artifactWorkspaceChartProjectionV3Schema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  toGovernedVChartPanels,
  toGovernedVChartSpec,
} from "@/components/workbench/governed-vchart-spec";

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
  it.each(["LINE", "BAR", "HORIZONTAL_BAR"] as const)(
    "preserves NULL and every period in validated V3 %s panels",
    (chart_type) => {
      const source = artifactWorkspaceChartProjectionV3Schema.parse({
        ...projection("LINE"),
        chart_type,
        lower_bound_key: null,
        upper_bound_key: null,
        series_key: null,
        evidence_level: "L2_OBSERVATION",
        y_keys: ["order_count", "prior"],
        table: {
          ...projection("LINE").table,
          columns: [
            ...projection("LINE").table.columns,
            { key: "prior", label: "同期", data_type: "NUMBER" },
          ],
          rows: [
            { month: "2026-01", order_count: 41, prior: 40 },
            { month: "2026-02", order_count: 73, prior: null },
            { month: "2026-03", order_count: 63, prior: 70 },
          ],
          total_rows: 3,
        },
      });
      const original = structuredClone(source);
      const panels = toGovernedVChartPanels(source);
      expect(panels).toHaveLength(2);
      for (const { spec } of panels) {
        expect(spec).toMatchObject({
          invalidType: "break",
          data: [{ values: original.table.rows }],
        });
      }
      expect(panels[1]?.spec).toMatchObject(
        chart_type === "HORIZONTAL_BAR"
          ? { xField: "prior", yField: "month", direction: "horizontal" }
          : { xField: "month", yField: "prior" },
      );
      expect(source).toEqual(original);
    },
  );

  it.each(["LINE", "BAR"] as const)(
    "renders all %s measures on separate named axes without mixing amount and ratio",
    (chartType) => {
      const source = projection(chartType);
      source.y_keys = ["current", "prior", "ratio"];
      source.legend.visible = true;
      source.table.columns = [
        { key: "month", label: "月份", data_type: "STRING" },
        { key: "current", label: "本期收入", data_type: "NUMBER" },
        { key: "prior", label: "上年同期收入", data_type: "NUMBER" },
        { key: "ratio", label: "同比增速", data_type: "NUMBER" },
      ];
      source.table.rows = [
        { month: "2026-01", current: 110, prior: null, ratio: null },
        { month: "2026-02", current: 120, prior: 100, ratio: 0.2 },
      ];
      const panels = toGovernedVChartPanels(source);
      expect(panels.map(({ key, label }) => ({ key, label }))).toEqual([
        { key: "current", label: "本期收入" },
        { key: "prior", label: "上年同期收入" },
        { key: "ratio", label: "同比增速" },
      ]);
      expect(panels.map(({ spec }) => (spec as { yField?: string }).yField)).toEqual([
        "current",
        "prior",
        "ratio",
      ]);
      for (const panel of panels) {
        expect(panel.spec).toMatchObject({
          invalidType: "break",
          legends: { visible: false },
          data: [
            {
              values: [
                { month: "2026-01", current: 110, prior: null, ratio: null },
                { month: "2026-02", current: 120, prior: 100, ratio: 0.2 },
              ],
            },
          ],
        });
      }
      expect(source.y_keys).toEqual(["current", "prior", "ratio"]);
      expect(() => toGovernedVChartSpec(source)).toThrow("VCHART_MULTIPLE_MEASURES_REQUIRE_PANELS");
    },
  );
  it("formats the time axis from the sealed column display and leaves the dataset untouched", () => {
    const source = projection("LINE");
    source.table.columns[0] = {
      key: "month",
      label: "月份",
      data_type: "STRING",
      display: {
        kind: "TEMPORAL",
        logical_type: "DATETIME",
        granularity: "month",
        timezone: "Asia/Shanghai",
      },
    };
    source.table.rows = [
      { month: "2023-10-31T16:00:00.000Z", order_count: 41 },
      { month: "2023-11-30T16:00:00.000Z", order_count: 73 },
    ];
    expect(toGovernedVChartSpec(source)).toMatchObject({
      data: [
        {
          values: [
            { month: "2023-11", order_count: 41 },
            { month: "2023-12", order_count: 73 },
          ],
        },
      ],
    });
    expect(source.table.rows[0]?.month).toBe("2023-10-31T16:00:00.000Z");
  });
  it("keeps missing observations as explicit gaps, not zero or connected lines", () => {
    const source = projection("LINE");
    source.table.rows.splice(1, 0, { month: "2026-01-gap", order_count: null });
    source.table.total_rows = 3;
    const spec = toGovernedVChartSpec(source);
    expect(spec).toMatchObject({
      invalidType: "break",
      data: [
        {
          values: [
            { month: "2026-01", order_count: 41 },
            { month: "2026-01-gap", order_count: null },
            { month: "2026-02", order_count: 73 },
          ],
        },
      ],
    });
    expect(source.table.rows[1]?.order_count).toBeNull();
  });

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

  it("binds a governed V3 series key for multi-cohort charts", () => {
    const value: ArtifactPreviewResultV3["projection"] = {
      kind: "CHART",
      chart_type: "LINE",
      title: "cohort 留存与复购",
      description: null,
      unit: "%",
      x_key: "month_index",
      y_keys: ["rate_pct"],
      lower_bound_key: null,
      upper_bound_key: null,
      series_key: "series",
      legend: { visible: true },
      evidence_level: "L2_OBSERVATION",
      table: {
        kind: "TABLE",
        columns: [
          { key: "month_index", label: "月龄", data_type: "NUMBER" },
          { key: "rate_pct", label: "比率", data_type: "NUMBER" },
          { key: "series", label: "批次 / 指标", data_type: "STRING" },
        ],
        rows: [{ month_index: 0, rate_pct: 100, series: "2025-01 / 留存率" }],
        total_rows: 1,
      },
    };

    expect(toGovernedVChartSpec(value)).toMatchObject({
      type: "line",
      seriesField: "series",
    });
  });
});
