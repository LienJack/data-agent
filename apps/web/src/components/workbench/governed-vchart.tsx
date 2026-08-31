"use client";

import type { ArtifactPreviewResultV2, ArtifactPreviewResultV3 } from "@data-agent/contracts";
import VChartCore from "@visactor/vchart/esm/vchart-simple";
import { useEffect, useMemo, useRef, useState } from "react";
import { toGovernedVChartPanels } from "./governed-vchart-spec";

type ChartProjection =
  | ArtifactPreviewResultV2["projection"]
  | ArtifactPreviewResultV3["projection"];

export default function GovernedVChart({
  projection,
  describedBy,
}: {
  readonly projection: ChartProjection;
  readonly describedBy?: string;
}) {
  const containers = useRef(new Map<string, HTMLDivElement>());
  const [renderState, setRenderState] = useState<"PENDING" | "READY" | "FAILED">("PENDING");
  const panels = useMemo(() => toGovernedVChartPanels(projection), [projection]);

  useEffect(() => {
    setRenderState("PENDING");
    const charts: VChartCore[] = [];
    try {
      for (const panel of panels) {
        const target = containers.current.get(panel.key);
        if (!target) throw new Error("VCHART_PANEL_TARGET_MISSING");
        const chart = new VChartCore(panel.spec, { dom: target, autoFit: true });
        charts.push(chart);
        chart.renderSync();
      }
      setRenderState("READY");
    } catch {
      for (const chart of charts) chart.release();
      setRenderState("FAILED");
      return;
    }
    return () => {
      for (const chart of charts) chart.release();
    };
  }, [panels]);

  return (
    <div
      className="relative w-full"
      role="img"
      aria-label={`${projection.title}图表${panels.length > 1 ? `：${panels.map((panel) => panel.label).join("、")}` : ""}`}
      aria-describedby={describedBy}
      data-testid="governed-chart"
      data-chart-render-state={renderState}
    >
      {panels.length > 1 ? (
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          {"facet_key" in projection && projection.facet_key !== undefined
            ? "按指标与原始分类分图，各图使用独立纵轴。"
            : "按指标分图，各图使用独立纵轴。"}
        </p>
      ) : null}
      {panels.map((panel) => (
        <div key={panel.key} data-chart-measure={panel.key}>
          {panel.label ? (
            <h3 className="mt-4 text-xs font-medium text-[var(--color-text-primary)]">
              {panel.label}
            </h3>
          ) : null}
          <div
            className={panels.length > 1 ? "h-[240px] w-full" : "h-[320px] w-full"}
            ref={(node) => {
              if (node) containers.current.set(panel.key, node);
              else containers.current.delete(panel.key);
            }}
          />
        </div>
      ))}
      {renderState === "FAILED" ? (
        <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-[var(--color-text-muted)]">
          <p>
            图表暂时无法渲染，请查看下方等价数据表。
            <code className="mt-2 block font-mono text-[10px]">VCHART_RENDER_FAILED</code>
          </p>
        </div>
      ) : null}
    </div>
  );
}
