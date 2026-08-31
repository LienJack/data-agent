import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GovernedVChart from "@/components/workbench/governed-vchart";

describe("GovernedVChart measure panels", () => {
  it("names each source facet and keeps the initial render state pending", () => {
    const markup = renderToStaticMarkup(
      <GovernedVChart
        projection={{
          kind: "CHART",
          chart_type: "LINE",
          title: "渠道趋势",
          description: null,
          unit: null,
          x_key: "month",
          y_keys: ["value"],
          series_key: "channel",
          facet_key: "audience",
          lower_bound_key: null,
          upper_bound_key: null,
          evidence_level: "L2_OBSERVATION",
          legend: { visible: true },
          table: {
            kind: "TABLE",
            columns: [
              { key: "month", label: "月份", data_type: "STRING" },
              { key: "value", label: "收入", data_type: "NUMBER" },
              { key: "channel", label: "渠道", data_type: "STRING" },
              { key: "audience", label: "客群", data_type: "STRING" },
            ],
            rows: [
              { month: "2024-01", value: 100, channel: "Email", audience: "新客" },
              { month: "2024-01", value: 200, channel: "Email", audience: "老客" },
            ],
            total_rows: 2,
          },
        }}
      />,
    );
    expect(markup).toContain("客群：新客");
    expect(markup).toContain("客群：老客");
    expect(markup).toContain("按指标与原始分类分图");
    expect(markup).toContain('data-chart-render-state="PENDING"');
    expect(markup).not.toContain('data-chart-render-state="READY"');
  });

  it("renders each named measure and declares independent vertical axes", () => {
    const markup = renderToStaticMarkup(
      <GovernedVChart
        projection={{
          kind: "CHART",
          chart_type: "LINE",
          title: "收入同比",
          description: null,
          unit: null,
          x_key: "month",
          y_keys: ["current", "prior", "ratio"],
          legend: { visible: true },
          table: {
            kind: "TABLE",
            columns: [
              { key: "month", label: "月份", data_type: "STRING" },
              { key: "current", label: "本期收入", data_type: "NUMBER" },
              { key: "prior", label: "上年同期收入", data_type: "NUMBER" },
              { key: "ratio", label: "同比增速", data_type: "NUMBER" },
            ],
            rows: [
              { month: "2026-01", current: 100, prior: null, ratio: null },
              { month: "2026-02", current: 120, prior: 100, ratio: 0.2 },
            ],
            total_rows: 2,
          },
        }}
      />,
    );
    expect(markup).toContain('data-chart-measure="current"');
    expect(markup).toContain('data-chart-measure="prior"');
    expect(markup).toContain('data-chart-measure="ratio"');
    expect(markup).toContain("本期收入");
    expect(markup).toContain("上年同期收入");
    expect(markup).toContain("同比增速");
    expect(markup).toContain("独立纵轴");
  });
});
