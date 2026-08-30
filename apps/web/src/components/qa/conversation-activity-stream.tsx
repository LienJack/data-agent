"use client";

import type { PublicRunEvent, QaInspectorTarget } from "@data-agent/contracts";
import { CaretDown, CaretRight, ChartLine, GitBranch, Robot, Table } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { ArtifactPreviewPanel } from "@/components/workbench/artifact-preview-panel";
import { useWorkspaceI18n } from "@/i18n";
import {
  artifactReferencesBefore,
  type ConversationActivityBlock,
  type TeamAgentView,
} from "@/lib/qa-event-assembler";
import { useQAStore } from "@/lib/qa-store";
import { durationLabel, ProcessDisclosure, statusClass } from "./process-disclosure";
import { SafeAssistantMarkdown } from "./safe-assistant-markdown";

function AgentDisclosure({ agent }: { agent: TeamAgentView }) {
  const { t } = useWorkspaceI18n();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const selectInspector = useQAStore((state) => state.selectInspector);
  const openTrajectory = useQAStore((state) => state.openTrajectory);
  const isRoot = agent.profileId === "data-agent-orchestrator";
  const triggerId = `qa-${isRoot ? "root" : "subagent"}-${agent.runId}-${agent.taskId ?? agent.profileId}`;
  const target: QaInspectorTarget | null =
    agent.taskId && !isRoot
      ? {
          kind: "subagent",
          run_id: agent.runId,
          profile_id: agent.profileId as Extract<
            QaInspectorTarget,
            { kind: "subagent" }
          >["profile_id"],
          task_id: agent.taskId,
          anchor_sequence: agent.sequence,
        }
      : null;

  return (
    <div
      className="border-b border-[var(--color-border-default)] last:border-b-0"
      data-testid="qa-agent-activity"
      data-agent-profile={agent.profileId}
      data-agent-task-id={agent.taskId}
      data-agent-status={agent.status}
      data-agent-role={isRoot ? "ROOT" : "SPECIALIST"}
    >
      <div className="flex min-h-11 items-center gap-1.5 px-1.5 py-1.5">
        {target || isRoot ? (
          <button
            id={triggerId}
            type="button"
            onClick={() => {
              if (isRoot) openTrajectory({ runId: agent.runId, sequence: agent.sequence });
              else if (target) selectInspector(target, triggerId);
            }}
            className="flex min-w-0 shrink-0 items-center gap-2 rounded px-1 py-1 text-left hover:bg-[var(--color-bg-overlay)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <span className="flex size-6 items-center justify-center rounded bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]">
              <Robot aria-hidden="true" size={14} />
            </span>
            <span
              data-agent-label
              className="text-[11px] font-semibold text-[var(--color-text-primary)]"
            >
              {t(isRoot ? "process.rootAgent" : "process.subagent")} · {agent.title}
            </span>
          </button>
        ) : (
          <span
            className="flex min-w-0 shrink-0 items-center gap-2 px-1 py-1"
            title={t("process.pendingInspector")}
          >
            <span className="flex size-6 items-center justify-center rounded bg-[var(--color-bg-overlay)] text-[var(--color-text-muted)]">
              <Robot aria-hidden="true" size={14} />
            </span>
            <span
              data-agent-label
              className="text-[11px] font-semibold text-[var(--color-text-muted)]"
            >
              {t("process.subagent")} · {agent.title}
            </span>
          </span>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-2 text-left hover:bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-text-muted)]">
            {agent.summary}
          </span>
          <span
            aria-live={agent.status === "RUNNING" ? "polite" : undefined}
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] font-semibold ${statusClass(agent.status)} ${agent.status === "RUNNING" ? "motion-safe:animate-pulse" : ""}`}
          >
            {agent.status}
          </span>
          {agent.durationMs !== null && (
            <span className="shrink-0 font-mono text-[9px] text-[var(--color-text-muted)]">
              {durationLabel(agent.durationMs)}
            </span>
          )}
          <span aria-hidden="true" className="text-[var(--color-text-muted)]">
            {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </span>
        </button>
      </div>
      {expanded && (
        <div id={panelId} className="pb-2">
          <div className="ml-9 mb-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
            <span className="font-mono">{agent.phase}</span>
            {agent.errorCode && (
              <span className="font-mono text-[var(--color-error)]">{agent.errorCode}</span>
            )}
            <button
              type="button"
              onClick={() => openTrajectory({ runId: agent.runId, sequence: agent.sequence })}
              className="font-mono font-semibold uppercase text-[var(--color-accent)] hover:underline"
            >
              {t("process.trace")}
            </button>
          </div>
          {agent.children.map((row) => (
            <ProcessDisclosure key={row.id} row={row} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactActivity({
  block,
}: {
  block: Extract<ConversationActivityBlock, { kind: "artifact" }>;
}) {
  const selectInspector = useQAStore((state) => state.selectInspector);
  const triggerId = `qa-inline-artifact-${block.reference.artifact_id}-${block.reference.revision}`;
  const ChartIcon =
    block.reference.artifact_type === "ArtifactWorkspaceDocument" ? ChartLine : Table;
  return (
    <section
      className="reading-surface glass-panel-radius my-3 overflow-hidden border p-2"
      aria-label={`${block.reference.artifact_type} 数据展示`}
    >
      <div className="flex items-center justify-between gap-3 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]">
            <ChartIcon aria-hidden="true" size={15} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{block.reference.artifact_type}</p>
            <p className="truncate font-mono text-[9px] text-[var(--color-text-muted)]">
              rev {block.reference.revision} · {block.reference.content_hash}
            </p>
          </div>
        </div>
        <button
          id={triggerId}
          type="button"
          onClick={() =>
            selectInspector(
              {
                kind: "artifact",
                run_id: block.runId,
                reference: block.reference,
                anchor_sequence: block.sequence,
              },
              triggerId,
            )
          }
          className="shrink-0 rounded-lg border border-[var(--color-border-default)] bg-white/70 px-2.5 py-1.5 text-[10px] font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)]"
        >
          侧栏查看
        </button>
      </div>
      <ArtifactPreviewPanel reference={block.reference} pageSize={50} />
    </section>
  );
}

export function ConversationActivityStream({
  blocks,
  events,
  runId,
  streaming = false,
}: {
  blocks: readonly ConversationActivityBlock[];
  events: readonly PublicRunEvent[];
  runId: string;
  streaming?: boolean;
}) {
  const openTrajectory = useQAStore((state) => state.openTrajectory);
  const terminal = events.findLast((event) => event.run_id === runId && event.type === "terminal");
  return (
    <article className="agent-activity-stream" aria-label="Data Agent 回答">
      <section aria-label="回答与公开执行活动">
        {blocks.map((block) => {
          if (block.kind === "text") {
            return (
              <section key={block.id} className="agent-answer py-2.5" aria-label="回答正文">
                <SafeAssistantMarkdown
                  content={block.content}
                  runId={runId}
                  sequence={block.sequence}
                  artifactReferences={artifactReferencesBefore(events, block.sequence, runId)}
                  streaming={streaming}
                />
              </section>
            );
          }
          if (block.kind === "agent") return <AgentDisclosure key={block.id} agent={block.agent} />;
          if (block.kind === "artifact") return <ArtifactActivity key={block.id} block={block} />;
          return <ProcessDisclosure key={block.id} row={block.row} />;
        })}
      </section>
      {terminal?.type === "terminal" && terminal.payload.status === "COMPLETED" ? (
        <button
          type="button"
          data-testid="qa-result-trace-entry"
          data-run-id={runId}
          data-terminal-status={terminal.payload.status}
          onClick={() => openTrajectory({ runId, sequence: terminal.sequence })}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-default)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--color-accent)] hover:border-[var(--color-accent)]"
        >
          <GitBranch aria-hidden="true" size={13} />
          查看此结果的运行轨迹
        </button>
      ) : null}
    </article>
  );
}
