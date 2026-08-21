"use client";

/** Modified from DeepSeek Harness ReasoningRow/ToolRow disclosure structure. */

import type { ArtifactReference, QaInspectorTarget } from "@data-agent/contracts";
import {
  Brain,
  CaretDown,
  CaretRight,
  FileCode,
  FlowArrow,
  TerminalWindow,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useWorkspaceI18n } from "@/i18n";
import type { ProcessRow, ProcessStatus } from "@/lib/qa-event-assembler";
import { useQAStore } from "@/lib/qa-store";

export function durationLabel(durationMs: number | null): string {
  if (durationMs === null) return "";
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

export function statusClass(status: ProcessStatus): string {
  if (status === "FAILED" || status === "BLOCKED") return "bg-red-50 text-red-700";
  if (status === "INTERRUPTED") return "bg-orange-50 text-orange-700";
  if (status === "RUNNING") return "bg-amber-50 text-amber-700";
  if (status === "COMPLETED") return "bg-emerald-50 text-emerald-700";
  return "bg-[var(--color-bg-overlay)] text-[var(--color-text-muted)]";
}

function artifactTriggerId(row: ProcessRow, reference: ArtifactReference): string {
  return `qa-artifact-${row.runId}-${reference.artifact_id}-${reference.revision}`;
}

export function ProcessDisclosure({ row, nested = false }: { row: ProcessRow; nested?: boolean }) {
  const { t } = useWorkspaceI18n();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const openTrajectory = useQAStore((state) => state.openTrajectory);
  const selectInspector = useQAStore((state) => state.selectInspector);
  const running = row.status === "RUNNING";
  const compactSummary = `${row.summary.slice(0, 180)}${row.summary.length > 180 ? "..." : ""}`;
  const ProcessIcon =
    row.kind === "tool" ? TerminalWindow : row.kind === "reasoning" ? Brain : FlowArrow;

  return (
    <div
      className={`${nested ? "relative ml-5 border-l border-[var(--color-border-overlay)] pl-3" : "border-b border-[var(--color-border-default)] last:border-b-0"}`}
      data-process-status={row.status}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        className="group flex min-h-10 w-full items-center gap-2 px-1.5 py-2 text-left outline-none hover:bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
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
          aria-live={running ? "polite" : undefined}
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase ${statusClass(row.status)} ${running ? "motion-safe:animate-pulse" : ""}`}
        >
          {row.status}
        </span>
        {row.durationMs !== null && (
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--color-text-muted)]">
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
          {row.artifactRefs.length > 0 && (
            <fieldset className="mt-3 flex flex-wrap gap-1.5">
              <legend className="sr-only">{t("process.artifacts")}</legend>
              {row.artifactRefs.map((reference) => {
                const triggerId = artifactTriggerId(row, reference);
                const target: QaInspectorTarget = {
                  kind: "artifact",
                  run_id: row.runId,
                  reference,
                  anchor_sequence: row.sequence,
                };
                return (
                  <button
                    id={triggerId}
                    key={`${reference.artifact_id}:${reference.revision}:${reference.content_hash}`}
                    type="button"
                    onClick={() => selectInspector(target, triggerId)}
                    className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--color-border-overlay)] bg-[var(--color-bg-surface)] px-2 py-1 text-[10px] font-medium text-[var(--color-accent)] hover:border-[var(--color-accent)] active:translate-y-px"
                  >
                    <FileCode aria-hidden="true" size={12} />
                    <span className="truncate">{reference.artifact_type}</span>
                    <span className="font-mono text-[8px]">r{reference.revision}</span>
                  </button>
                );
              })}
            </fieldset>
          )}
          {row.errorCode && (
            <p className="mt-3 font-mono text-[10px] text-[var(--color-error)]">{row.errorCode}</p>
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
