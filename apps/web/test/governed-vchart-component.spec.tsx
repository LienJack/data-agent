import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GovernedVChart from "@/components/workbench/governed-vchart";

describe("GovernedVChart measure panels", () => {
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
