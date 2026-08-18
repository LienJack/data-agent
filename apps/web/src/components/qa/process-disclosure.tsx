"use client";

import { Brain, CaretDown, CaretRight, FlowArrow, TerminalWindow } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useWorkspaceI18n } from "@/i18n";
import type { ProcessRow } from "@/lib/qa-event-assembler";
import { useQAStore } from "@/lib/qa-store";

function durationLabel(durationMs: number | null): string {
  if (durationMs === null) return "";
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

export function ProcessDisclosure({ row }: { row: ProcessRow }) {
  const { t } = useWorkspaceI18n();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const openTrajectory = useQAStore((state) => state.openTrajectory);
  const failed = row.status === "FAILED";
  const interrupted = row.status === "INTERRUPTED";
  const running = row.status === "RUNNING";
  const compactSummary = `${row.summary.slice(0, 180)}${row.summary.length > 180 ? "..." : ""}`;
  const ProcessIcon =
    row.kind === "tool" ? TerminalWindow : row.kind === "reasoning" ? Brain : FlowArrow;

  return (
    <div className="border-b border-[var(--color-border-default)] last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-10 w-full items-center gap-2 px-1.5 py-2 text-left outline-none hover:bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-[var(--color-bg-overlay)] text-[var(--color-text-secondary)]">
          <ProcessIcon aria-hidden="true" size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold text-[var(--color-text-primary)]">
            {row.kind === "tool"
              ? row.toolName
              : row.kind === "reasoning"
                ? t("process.thinking")
                : t("process.stage")}{" "}
            · {row.title}
          </span>
          <span className="ml-2 break-words text-[10px] text-[var(--color-text-muted)]">
            {compactSummary}
          </span>
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase ${
            failed
              ? "bg-red-50 text-red-700"
              : interrupted
                ? "bg-orange-50 text-orange-700"
                : running
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {row.status}
        </span>
        {row.durationMs !== null && (
          <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
            {durationLabel(row.durationMs)}
          </span>
        )}
        <span aria-hidden="true" className="shrink-0 text-[var(--color-text-muted)]">
          {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        </span>
      </button>

      {expanded && (
        <div
          id={panelId}
          className="mb-2 ml-8 border-l-2 border-[var(--color-border-overlay)] bg-[var(--color-bg-overlay)] p-3"
        >
          {row.input !== null && (
            <section className="mb-3">
              <p className="mb-1 font-semibold uppercase text-[var(--color-text-muted)]">
                {t("process.input")}
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-text-secondary)]">
                {row.input}
              </pre>
            </section>
          )}
          {row.output !== null && (
            <section>
              <p className="mb-1 font-semibold uppercase text-[var(--color-text-muted)]">
                {t("process.output")}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-text-secondary)]">
                {row.output}
              </pre>
            </section>
          )}
          {row.input === null && row.output === null && (
            <p className="whitespace-pre-wrap text-[var(--color-text-secondary)]">{row.summary}</p>
          )}
          <button
            type="button"
            onClick={() => openTrajectory({ runId: row.runId, sequence: row.sequence })}
            className="mt-3 font-mono text-[9px] font-semibold uppercase text-[var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            {t("process.locate")}
          </button>
        </div>
      )}
    </div>
  );
}
