import type { ArtifactPreviewResultV2, ArtifactPreviewResultV3 } from "@data-agent/contracts";
import { formatArtifactTableCell } from "@data-agent/contracts/artifacts";
import type { ISpec } from "@visactor/vchart";

type ChartProjection =
  | ArtifactPreviewResultV2["projection"]
  | ArtifactPreviewResultV3["projection"];

export function toGovernedVChartPanels(
  projection: ChartProjection,
): readonly { key: string; label: string | null; spec: ISpec }[] {
  if (
    ["LINE", "BAR", "HORIZONTAL_BAR", "SIGNED_CONTRIBUTION"].includes(projection.chart_type) &&
    projection.y_keys.length > 1
  ) {
    return projection.y_keys.map((key) => ({
      key,
      label: projection.table.columns.find((column) => column.key === key)?.label ?? key,
      spec: toGovernedVChartSpec({ ...projection, y_keys: [key] }),
    }));
  }
  return [{ key: "chart", label: null, spec: toGovernedVChartSpec(projection) }];
}

export function toGovernedVChartSpec(projection: ChartProjection): ISpec {
  const values = projection.table.rows.map((row) =>
    Object.fromEntries(
      projection.table.columns.map((column) => [
        column.key,
        column.display && column.key === projection.x_key && row[column.key] !== null
          ? formatArtifactTableCell(row[column.key] ?? null, column)
          : (row[column.key] ?? null),
      ]),
    ),
  );
  const base = {
    animation: false,
    background: "transparent",
    data: [{ id: "governed-data", values }],
    padding: { top: 18, right: 16, bottom: 10, left: 10 },
    tooltip: { visible: true },
  };
  if (projection.chart_type === "PIE") {
    return {
      ...base,
      type: "pie" as const,
      categoryField: projection.x_key,
      valueField: projection.y_keys[0],
      outerRadius: 0.82,
      innerRadius: 0.48,
      legends: { visible: projection.legend.visible, orient: "right" as const },
    } as ISpec;
  }
  if (
    projection.chart_type === "SCATTER" ||
    projection.chart_type === "RELATIONSHIP" ||
    projection.chart_type === "PRIORITY_MATRIX"
  ) {
    return {
      ...base,
      type: "scatter" as const,
      xField: projection.x_key,
      yField: [...projection.y_keys],
      seriesField: projection.series_key ?? undefined,
      legends: { visible: projection.legend.visible, orient: "top" as const },
    } as ISpec;
  }
  if (projection.chart_type === "AREA_RANGE" || projection.chart_type === "FORECAST_INTERVAL") {
    return {
      ...base,
      type: "rangeArea" as const,
      xField: projection.x_key,
      yField: [projection.lower_bound_key, projection.upper_bound_key],
      seriesField: projection.series_key ?? undefined,
      legends: { visible: projection.legend.visible, orient: "top" as const },
    } as ISpec;
  }
  const horizontal = ["HORIZONTAL_BAR", "SIGNED_CONTRIBUTION"].includes(projection.chart_type);
  if (projection.y_keys.length !== 1)
    throw new TypeError("VCHART_MULTIPLE_MEASURES_REQUIRE_PANELS");
  const seriesKey = "series_key" in projection ? (projection.series_key ?? undefined) : undefined;
  return {
    ...base,
    type: projection.chart_type === "LINE" ? ("line" as const) : ("bar" as const),
    invalidType: "break" as const,
    direction: horizontal ? ("horizontal" as const) : undefined,
    xField: horizontal ? projection.y_keys[0] : projection.x_key,
    yField: horizontal ? projection.x_key : projection.y_keys[0],
    seriesField: seriesKey,
    point: projection.chart_type === "LINE" ? { visible: true } : undefined,
    legends: { visible: Boolean(seriesKey) && projection.legend.visible, orient: "top" as const },
    axes: [
      { orient: "bottom" as const, type: horizontal ? ("linear" as const) : ("band" as const) },
      {
        orient: "left" as const,
        type: horizontal ? ("band" as const) : ("linear" as const),
        title: { visible: Boolean(projection.unit), text: projection.unit ?? "" },
      },
    ],
  } as ISpec;
}
