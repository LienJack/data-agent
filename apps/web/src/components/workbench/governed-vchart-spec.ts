import type { ArtifactPreviewResultV2 } from "@data-agent/contracts";
import type { ISpec } from "@visactor/vchart";

type ChartProjection = ArtifactPreviewResultV2["projection"];

export function toGovernedVChartSpec(projection: ChartProjection): ISpec {
  const values = projection.table.rows.map((row) =>
    Object.fromEntries(projection.table.columns.map(({ key }) => [key, row[key] ?? null])),
  );
  const base = {
    animation: false,
    background: "transparent",
    data: [{ id: "governed-data", values }],
    padding: { top: 18, right: 16, bottom: 10, left: 10 },
    tooltip: { visible: true },
  };
  return (
    projection.chart_type === "PIE"
      ? {
          ...base,
          type: "pie" as const,
          categoryField: projection.x_key,
          valueField: projection.y_keys[0],
          outerRadius: 0.82,
          innerRadius: 0.48,
          legends: { visible: projection.legend.visible, orient: "right" as const },
        }
      : {
          ...base,
          type: projection.chart_type === "LINE" ? ("line" as const) : ("bar" as const),
          xField: projection.x_key,
          yField: [...projection.y_keys],
          point: projection.chart_type === "LINE" ? { visible: true } : undefined,
          legends: { visible: projection.legend.visible, orient: "top" as const },
          axes: [
            { orient: "bottom" as const, type: "band" as const },
            {
              orient: "left" as const,
              type: "linear" as const,
              title: { visible: Boolean(projection.unit), text: projection.unit ?? "" },
            },
          ],
        }
  ) as ISpec;
}
