"use client";

import { CaretDown, CaretRight } from "@phosphor-icons/react";
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

  return (
    <div className="border-l border-[var(--color-border-default)] pl-3 text-xs">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-2 rounded py-1.5 text-left outline-none hover:bg-[var(--color-bg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        <span
          aria-hidden="true"
          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
            failed
              ? "bg-red-500"
              : interrupted
                ? "bg-orange-500"
                : running
                  ? "animate-pulse bg-amber-500"
                  : "bg-emerald-500"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-[var(--color-text-secondary)]">
            {row.kind === "tool"
              ? row.toolName
              : row.kind === "reasoning"
                ? t("process.thinking")
                : t("process.stage")}{" "}
            · {row.title}
          </span>
          <span className="ml-2 break-words text-[var(--color-text-muted)]">{compactSummary}</span>
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
        <div id={panelId} className="mb-2 rounded-md bg-[var(--color-bg-tertiary)] p-3">
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
            className="mt-3 text-[var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            {t("process.locate")}
          </button>
        </div>
      )}
    </div>
  );
}
