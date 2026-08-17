"use client";

import type { AgentProductProfileRegistryItem, AgentTeamPublicTrace } from "@data-agent/contracts";
import { FlowArrow, Hammer, ShieldCheck } from "@phosphor-icons/react";

const labels = {
  "governed-text2sql-agent": "Text2SQL",
  "report-writing-agent": "Report",
  "semantic-management-agent": "Semantic",
} as const;

export function AgentTeamTrace({
  profiles,
  trace,
  error = null,
}: {
  readonly profiles: readonly AgentProductProfileRegistryItem[];
  readonly trace: AgentTeamPublicTrace | null;
  readonly error?: string | null;
}) {
  if (error) {
    return (
      <p className="p-5 text-xs text-red-700" role="alert">
        {error}
      </p>
    );
  }
  if (profiles.length === 0 && trace === null) {
    return (
      <p className="p-5 text-xs text-[var(--color-text-muted)]" role="status">
        当前工作空间尚未启用 Agent Profile
      </p>
    );
  }
  return (
    <div>
      {trace && (
        <div className="grid grid-cols-2 gap-px border-b border-[var(--color-border-default)] bg-[var(--color-border-default)] sm:grid-cols-4">
          {[
            ["Tasks", trace.tasks.length],
            ["Handoffs", trace.handoffs.length],
            ["Epochs", trace.epochs.length],
            ["Verifiers", trace.verifier_decisions.length],
          ].map(([label, value]) => (
            <div key={label} className="bg-[var(--color-bg-primary)] px-4 py-3">
              <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}
      {trace && trace.tasks.length > 0 && (
        <ol className="divide-y divide-[var(--color-border-default)] border-b border-[var(--color-border-default)]">
          {trace.tasks.map((task) => (
            <li
              key={task.task_id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-5 py-3 text-[11px]"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{task.profile_id}</p>
                <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                  {task.task_id}
                </p>
              </div>
              <span className="self-start rounded border border-[var(--color-border-default)] px-2 py-1 text-[10px]">
                {task.status}
              </span>
            </li>
          ))}
        </ol>
      )}
      <ul className="divide-y divide-[var(--color-border-default)]">
        {profiles.map(({ revision, head }) => (
          <li key={revision.profile_id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${head.lifecycle === "ENABLED" ? "bg-emerald-500" : "bg-amber-500"}`}
                  />
                  <h3 className="text-xs font-semibold">{labels[revision.profile_id]}</h3>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    r{revision.revision} · {head.lifecycle}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                  {revision.revision_hash}
                </p>
              </div>
              <span className="rounded border border-[var(--color-border-default)] px-2 py-1 text-[10px]">
                {revision.approval_status}
              </span>
            </div>
            <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="flex items-center gap-1 text-[var(--color-text-muted)]">
                  <FlowArrow size={13} /> Workflow
                </dt>
                <dd className="mt-1 truncate" title={revision.workflow_ref.workflow_id}>
                  {revision.workflow_ref.workflow_id}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-[var(--color-text-muted)]">
                  <ShieldCheck size={13} /> Skills
                </dt>
                <dd className="mt-1 tabular-nums">{revision.skill_refs.length} revisions</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-[var(--color-text-muted)]">
                  <Hammer size={13} /> Tools
                </dt>
                <dd className="mt-1 tabular-nums">
                  {revision.direct_tool_allowlist.length} direct
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
