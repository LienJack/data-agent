"use client";

import type { ArtifactPreviewResultV2 } from "@data-agent/contracts";
import VChartCore from "@visactor/vchart/esm/vchart-simple";
import { useEffect, useMemo, useRef, useState } from "react";
import { toGovernedVChartSpec } from "./governed-vchart-spec";

type ChartProjection = ArtifactPreviewResultV2["projection"];

export default function GovernedVChart({
  projection,
  describedBy,
}: {
  readonly projection: ChartProjection;
  readonly describedBy?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const spec = useMemo(() => toGovernedVChartSpec(projection), [projection]);

  useEffect(() => {
    const target = container.current;
    if (!target) return;
    setRenderFailed(false);
    let chart: VChartCore | null = null;
    try {
      chart = new VChartCore(spec, { dom: target, autoFit: true });
      chart.renderSync();
    } catch {
      chart?.release();
      setRenderFailed(true);
      return;
    }
    return () => chart?.release();
  }, [spec]);

  return (
    <div
      className="relative h-[320px] w-full"
      role="img"
      aria-label={`${projection.title}图表`}
      aria-describedby={describedBy}
    >
      <div className="h-full w-full" ref={container} />
      {renderFailed ? (
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
