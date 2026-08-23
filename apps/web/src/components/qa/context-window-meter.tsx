"use client";

/** Modified from DeepSeek Harness ContextMeter interaction at fixed commit 47f943859bef60e4160492346772ded9b24f765a. */

import type { ModelRequestPerformance } from "@data-agent/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { contextWindowOccupancy } from "@/lib/model-request-performance";

function compactTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function ContextWindowMeter({
  performance,
}: {
  readonly performance: ModelRequestPerformance | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const occupancy = useMemo(() => contextWindowOccupancy(performance), [performance]);

  useEffect(() => {
    if (!occupancy) setOpen(false);
  }, [occupancy]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!occupancy || !performance) return null;
  const circumference = 2 * Math.PI * 8;
  const dashOffset = circumference * (1 - occupancy.percent / 100);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`最近一次请求上下文已用 ${occupancy.percent}%`}
        aria-expanded={open}
        aria-controls="qa-context-window-popover"
        title={`上下文已用 ${occupancy.percent}%`}
        onClick={() => setOpen((current) => !current)}
        className="control-pressable flex size-8 items-center justify-center rounded-full text-[var(--color-text-muted)] outline-none hover:bg-[var(--color-bg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--color-border-focused)]"
      >
        <svg viewBox="0 0 20 20" className="size-5 -rotate-90" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            opacity="0.2"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
      </button>
      {open && (
        <section
          id="qa-context-window-popover"
          role="dialog"
          aria-label="上下文窗口明细"
          className="surface-floating-strong absolute bottom-11 right-0 z-50 w-[260px] rounded-2xl border border-[var(--color-border-default)] p-4 shadow-[0_20px_55px_-28px_rgb(30_64_175_/_0.4)]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium">最近一次请求上下文</p>
            <p className="font-mono text-xs font-semibold">
              {compactTokens(occupancy.used)} / {compactTokens(occupancy.capacity)}
            </p>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)]"
              style={{ width: `${occupancy.percent}%` }}
            />
          </div>
          <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[11px]">
            <dt className="text-[var(--color-text-muted)]">占用比例</dt>
            <dd className="font-medium">{occupancy.percent}%</dd>
            <dt className="text-[var(--color-text-muted)]">请求输入</dt>
            <dd className="font-mono">{compactTokens(occupancy.usage.input_tokens)}</dd>
            <dt className="text-[var(--color-text-muted)]">模型输出</dt>
            <dd className="font-mono">{compactTokens(occupancy.usage.output_tokens)}</dd>
            <dt className="text-[var(--color-text-muted)]">本次合计</dt>
            <dd className="font-mono">{compactTokens(occupancy.usage.total_tokens)}</dd>
          </dl>
          <p className="mt-3 border-t border-[var(--color-border-default)] pt-3 text-[9px] leading-4 text-[var(--color-text-muted)]">
            {performance.provider}/{performance.model_id} · Provider reported · 不含当前未发送草稿
          </p>
        </section>
      )}
    </div>
  );
}
