"use client";

/** Modified from DeepSeek Harness AppFrame/DetailsPanel and durable Session baseline/live flow. */

import type { ArtifactReference, PublicRunEvent, QaInspectorTarget } from "@data-agent/contracts";
import { FileCode, Path, Robot, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtifactPreviewPanel } from "@/components/workbench/artifact-preview-panel";
import { useWorkspaceI18n } from "@/i18n";
import { assembleSubagentInspector } from "@/lib/qa-event-assembler";
import { computeInspectorColumns } from "@/lib/qa-inspector-layout";
import {
  useQAActiveRunId,
  useQAConnection,
  useQAEvents,
  useQAInspectorTarget,
  useQAInspectorWidth,
  useQALoading,
  useQAStore,
} from "@/lib/qa-store";
import { durationLabel, statusClass } from "./process-disclosure";

function referenceIdentity(reference: ArtifactReference): string {
  return `${reference.artifact_id}:${reference.revision}:${reference.content_hash}`;
}

function eventSummary(event: PublicRunEvent): string {
  if (event.type === "agent") return event.payload.summary;
  if (event.type === "tool") return event.payload.summary;
  return "";
}

function ArtifactInspector({
  target,
  events,
  loadingReplay,
}: {
  target: Extract<QaInspectorTarget, { kind: "artifact" }>;
  events: readonly PublicRunEvent[];
  loadingReplay: boolean;
}) {
  const { t } = useWorkspaceI18n();
  const seenInReplay = events.some(
    (event) =>
      event.run_id === target.run_id &&
      event.type === "tool" &&
      "artifact_refs" in event.payload &&
      event.payload.artifact_refs.some(
        (reference) => referenceIdentity(reference) === referenceIdentity(target.reference),
      ),
  );

  if (!seenInReplay && loadingReplay) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label={t("inspector.loadingArtifact")}>
        <div className="h-4 w-3/5 animate-pulse rounded bg-[var(--color-bg-overlay)]" />
        <div className="h-28 animate-pulse rounded bg-[var(--color-bg-overlay)]" />
      </div>
    );
  }
  if (!seenInReplay) {
    return (
      <div className="m-4 border-l-2 border-[var(--color-error)] bg-red-50 px-3 py-3">
        <p className="text-xs font-semibold text-red-800">{t("inspector.previewFailed")}</p>
        <p className="mt-1 text-xs text-red-700">{t("inspector.staleArtifact")}</p>
        <code className="mt-2 block font-mono text-[10px] text-red-700">
          ARTIFACT_INSPECTOR_TARGET_STALE
        </code>
      </div>
    );
  }
  return (
    <div className="p-3">
      <ArtifactPreviewPanel
        key={referenceIdentity(target.reference)}
        reference={target.reference}
        pageSize={100}
      />
    </div>
  );
}

type InspectorTab = "overview" | "events" | "artifacts";

export function SubagentInspector({
  target,
  events,
}: {
  target: Extract<QaInspectorTarget, { kind: "subagent" }>;
  events: readonly PublicRunEvent[];
}) {
  const { t } = useWorkspaceI18n();
  const [tab, setTab] = useState<InspectorTab>("overview");
  const snapshot = useMemo(() => assembleSubagentInspector(events, target), [events, target]);
  const connection = useQAConnection();
  const activeRunId = useQAActiveRunId();
  const selectInspector = useQAStore((state) => state.selectInspector);
  const connectionLabel = snapshot.terminal
    ? t("inspector.ended")
    : activeRunId === target.run_id
      ? connection === "reconnecting"
        ? t("inspector.reconnecting")
        : connection === "live"
          ? t("inspector.live")
          : t("inspector.connecting")
      : t("inspector.replay");

  if (snapshot.state === "stale" || !snapshot.agent) {
    return (
      <div className="m-4 border-l-2 border-[var(--color-warning)] bg-amber-50 px-3 py-3">
        <p className="text-xs font-semibold text-amber-900">{t("inspector.staleSubagent")}</p>
        <p className="mt-1 text-xs text-amber-800">{t("inspector.staleSubagentDescription")}</p>
        <code className="mt-2 block font-mono text-[10px] text-amber-800">
          SUBAGENT_INSPECTOR_TARGET_STALE
        </code>
      </div>
    );
  }

  const agent = snapshot.agent;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--color-border-default)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{agent.title}</p>
            <p className="mt-1 truncate font-mono text-[9px] text-[var(--color-text-muted)]">
              {agent.profileId} · {agent.taskId}
            </p>
          </div>
          <span className="rounded border border-[var(--color-border-default)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-muted)]">
            {connectionLabel}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${statusClass(agent.status)}`}
          >
            {agent.status}
          </span>
          <span className="font-mono text-[9px] text-[var(--color-text-muted)]">{agent.phase}</span>
          {agent.durationMs !== null && (
            <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
              {durationLabel(agent.durationMs)}
            </span>
          )}
        </div>
      </div>
      <div className="flex border-b border-[var(--color-border-default)] px-3" role="tablist">
        {(["overview", "events", "artifacts"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => setTab(candidate)}
            className={`border-b-2 px-2 py-2 text-[10px] font-medium ${tab === candidate ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-text-muted)]"}`}
          >
            {candidate === "overview"
              ? t("inspector.overview")
              : candidate === "events"
                ? t("inspector.events")
                : t("inspector.artifacts")}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "overview" && (
          <div className="space-y-4">
            <section>
              <h3 className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
                {t("inspector.currentSummary")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                {agent.summary}
              </p>
            </section>
            {agent.errorCode && (
              <code className="block border-l-2 border-[var(--color-error)] pl-2 font-mono text-[10px] text-[var(--color-error)]">
                {agent.errorCode}
              </code>
            )}
            <section>
              <h3 className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
                Tool
              </h3>
              <p className="mt-1 font-mono text-xs">{agent.children.length}</p>
            </section>
          </div>
        )}
        {tab === "events" && (
          <ol className="space-y-0 border-l border-[var(--color-border-overlay)] pl-3">
            {snapshot.events.map((event) => (
              <li
                key={`${event.run_id}:${event.sequence}`}
                className="relative border-b border-[var(--color-border-default)] py-2.5 last:border-b-0"
              >
                <span className="absolute -left-[15px] top-4 size-1.5 rounded-full bg-[var(--color-accent)]" />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                    #{event.sequence} · {event.type}
                  </span>
                  <span className="font-mono text-[8px] text-[var(--color-text-muted)]">
                    {event.occurred_at.slice(11, 19)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-secondary)]">
                  {eventSummary(event)}
                </p>
              </li>
            ))}
          </ol>
        )}
        {tab === "artifacts" && (
          <div className="space-y-2">
            {agent.artifactRefs.map((reference) => {
              const triggerId = `qa-inspector-artifact-${reference.artifact_id}-${reference.revision}`;
              return (
                <button
                  id={triggerId}
                  key={referenceIdentity(reference)}
                  type="button"
                  onClick={() =>
                    selectInspector(
                      {
                        kind: "artifact",
                        run_id: target.run_id,
                        reference,
                        anchor_sequence:
                          agent.children.find((row) =>
                            row.artifactRefs.some(
                              (item) => referenceIdentity(item) === referenceIdentity(reference),
                            ),
                          )?.sequence ?? target.anchor_sequence,
                      },
                      triggerId,
                    )
                  }
                  className="flex w-full items-center gap-2 border-b border-[var(--color-border-default)] px-1 py-2 text-left text-xs text-[var(--color-accent)] hover:bg-[var(--color-bg-overlay)]"
                >
                  <FileCode aria-hidden="true" size={15} />
                  <span className="min-w-0 flex-1 truncate">{reference.artifact_type}</span>
                  <span className="font-mono text-[9px]">r{reference.revision}</span>
                </button>
              );
            })}
            {agent.artifactRefs.length === 0 && (
              <p className="py-8 text-center text-xs text-[var(--color-text-muted)]">
                {t("inspector.noArtifacts")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResizeHandle({ width, setWidth }: { width: number; setWidth: (value: number) => void }) {
  const origin = useRef({ x: 0, width });
  return (
    <hr
      aria-label="调整 Inspector 宽度"
      aria-orientation="vertical"
      aria-valuemin={320}
      aria-valuemax={520}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setWidth(width + 12);
        if (event.key === "ArrowRight") setWidth(width - 12);
      }}
      onPointerDown={(event) => {
        origin.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        setWidth(origin.current.width - (event.clientX - origin.current.x));
      }}
      className="absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize touch-none min-[960px]:block"
    />
  );
}

export function QAInspector() {
  const { t } = useWorkspaceI18n();
  const target = useQAInspectorTarget();
  const width = useQAInspectorWidth();
  const events = useQAEvents();
  const loadingReplay = useQALoading();
  const close = useQAStore((state) => state.closeInspector);
  const setWidth = useQAStore((state) => state.setInspectorWidth);
  const hydrateWidth = useQAStore((state) => state.hydrateInspectorWidth);
  const openTrajectory = useQAStore((state) => state.openTrajectory);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const inspectorActive = target !== null;

  useEffect(() => hydrateWidth(), [hydrateWidth]);
  useEffect(() => {
    if (!inspectorActive) return;
    const container = inspectorRef.current?.parentElement;
    if (!container) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      setContainerWidth(container.getBoundingClientRect().width);
    };
    update();
    const observer = new ResizeObserver(() => {
      if (frame === null) frame = requestAnimationFrame(update);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [inspectorActive]);
  if (!target) return null;
  const columns = computeInspectorColumns(containerWidth, width, true);
  const desktopAutoCollapsed = containerWidth >= 768 && columns.details === 0;

  return (
    <aside
      ref={inspectorRef}
      aria-label="Q&A Inspector"
      className="qa-inspector min-h-0 flex-col bg-[var(--color-bg-surface)]"
      data-auto-collapsed={desktopAutoCollapsed || undefined}
      style={
        {
          width: `var(--qa-inspector-width, ${columns.details || width}px)`,
          "--qa-inspector-width": `${columns.details || width}px`,
        } as React.CSSProperties
      }
    >
      <ResizeHandle width={columns.details || width} setWidth={setWidth} />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border-default)] px-3">
        {target.kind === "subagent" ? (
          <Robot aria-hidden="true" size={15} />
        ) : (
          <FileCode aria-hidden="true" size={15} />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {target.kind === "subagent" ? t("inspector.subagentTitle") : t("inspector.artifactTitle")}
        </span>
        <button
          type="button"
          onClick={() => openTrajectory({ runId: target.run_id, sequence: target.anchor_sequence })}
          aria-label={t("process.locate")}
          className="flex size-7 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]"
        >
          <Path aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={t("inspector.close")}
          className="flex size-7 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {target.kind === "artifact" ? (
          <ArtifactInspector target={target} events={events} loadingReplay={loadingReplay} />
        ) : (
          <SubagentInspector
            key={`${target.profile_id}:${target.task_id}`}
            target={target}
            events={events}
          />
        )}
      </div>
    </aside>
  );
}
