"use client";

import type { AgentProductProfileRegistryItem, AgentTeamPublicTrace } from "@data-agent/contracts";
import { FlowArrow, Hammer, ShieldCheck } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useWorkspaceI18n } from "@/i18n";

const labels = {
  "data-agent-orchestrator": "Data Agent Orchestrator",
  "governed-text2sql-agent": "Text2SQL",
  "report-writing-agent": "Report",
  "semantic-management-agent": "Semantic",
} as const;

function profileLabel(profileId: string): string {
  return labels[profileId as keyof typeof labels] ?? profileId;
}

function shortIdentity(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

export function AgentTeamTrace({
  profiles,
  trace,
  error = null,
}: {
  readonly profiles: readonly AgentProductProfileRegistryItem[];
  readonly trace: AgentTeamPublicTrace | null;
  readonly error?: string | null;
}) {
  const { t } = useWorkspaceI18n();
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
        {t("team.empty")}
      </p>
    );
  }
  const taskById = new Map(trace?.tasks.map((task) => [task.task_id, task]) ?? []);
  const exactProfileFor = (task: NonNullable<typeof trace>["tasks"][number]) =>
    profiles.find(
      ({ revision }) =>
        revision.profile_id === task.profile_id &&
        revision.revision === task.profile_revision &&
        revision.revision_hash === task.profile_hash,
    );
  return (
    <div>
      {trace && (
        <div className="grid grid-cols-2 gap-px border-b border-[var(--color-border-default)] bg-[var(--color-border-default)] sm:grid-cols-4">
          {[
            [t("team.tasks"), trace.tasks.length],
            [t("team.handoffs"), trace.handoffs.length],
            [t("team.epochs"), trace.epochs.length],
            [t("team.verifiers"), trace.verifier_decisions.length],
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
                <p className="truncate font-semibold">{profileLabel(task.profile_id)}</p>
                <p className="mt-1 text-[10px] text-[var(--color-text-secondary)]">
                  {task.parent_task_id
                    ? `由 ${profileLabel(taskById.get(task.parent_task_id)?.profile_id ?? "未知 Agent")} 分派`
                    : "负责规划并汇总本次 Agent Team 执行"}
                </p>
                <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  {new Date(task.created_at).toLocaleString()} · task r{task.task_revision} ·
                  attempt {task.attempt_id.slice(0, 8)} · fence {task.worker_fence}
                </p>
                {!exactProfileFor(task) && task.profile_id !== "data-agent-orchestrator" && (
                  <p className="mt-1 text-[10px] text-amber-700">
                    历史 Profile 内容不可用；保留 exact r{task.profile_revision} 身份
                  </p>
                )}
                <details className="mt-2 text-[9px] text-[var(--color-text-muted)]">
                  <summary className="cursor-pointer">身份与来源</summary>
                  <dl className="mt-1 grid grid-cols-[80px_minmax(0,1fr)] gap-1 font-mono">
                    <dt>Task ID</dt>
                    <dd className="break-all">{task.task_id}</dd>
                    <dt>Profile</dt>
                    <dd className="break-all">
                      {task.profile_id} · r{task.profile_revision} ·{" "}
                      {shortIdentity(task.profile_hash)}
                    </dd>
                    <dt>Attempt</dt>
                    <dd className="break-all">{task.attempt_id}</dd>
                  </dl>
                </details>
              </div>
              <span className="self-start rounded border border-[var(--color-border-default)] px-2 py-1 text-[10px]">
                {task.status}
              </span>
            </li>
          ))}
        </ol>
      )}
      {trace &&
        (trace.handoffs.length > 0 ||
          trace.epochs.length > 0 ||
          trace.verifier_decisions.length > 0) && (
          <div className="grid border-b border-[var(--color-border-default)] lg:grid-cols-3">
            <TraceDisclosure title={t("team.handoffs")} count={trace.handoffs.length}>
              {trace.handoffs.map((handoff) => (
                <li key={handoff.handoff_id}>
                  {profileLabel(taskById.get(handoff.parent_task_id)?.profile_id ?? "未知 Agent")} →{" "}
                  {profileLabel(taskById.get(handoff.child_task_id)?.profile_id ?? "未知 Agent")}
                  <span className="mt-1 block text-[var(--color-text-muted)]">
                    {new Date(handoff.created_at).toLocaleString()} · parent r
                    {handoff.parent_expected_revision}
                  </span>
                  <span className="mt-1 block font-mono text-[var(--color-text-muted)]">
                    {shortIdentity(handoff.request_hash)}
                  </span>
                </li>
              ))}
            </TraceDisclosure>
            <TraceDisclosure title={t("team.epochs")} count={trace.epochs.length}>
              {trace.epochs.map((epoch) => (
                <li key={`${epoch.task_id}:${epoch.epoch_id}:${epoch.epoch_revision}`}>
                  {profileLabel(taskById.get(epoch.task_id)?.profile_id ?? "未知 Agent")} ·{" "}
                  {epoch.phase}
                  <span className="mt-1 block text-[var(--color-text-muted)]">
                    {new Date(epoch.created_at).toLocaleString()} · epoch r{epoch.epoch_revision}
                  </span>
                  <span className="mt-1 block font-mono text-[var(--color-text-muted)]">
                    {shortIdentity(epoch.build_signature)}
                  </span>
                </li>
              ))}
            </TraceDisclosure>
            <TraceDisclosure title={t("team.verifiers")} count={trace.verifier_decisions.length}>
              {trace.verifier_decisions.map((decision) => (
                <li key={decision.decision_id}>
                  {profileLabel(taskById.get(decision.task_id)?.profile_id ?? "未知 Agent")} ·
                  已提交验证决定
                  <span className="mt-1 block text-[var(--color-text-muted)]">
                    {new Date(decision.created_at).toLocaleString()} · task r
                    {decision.task_revision}
                  </span>
                  <span className="mt-1 block font-mono text-[var(--color-text-muted)]">
                    {shortIdentity(decision.decision_hash)}
                  </span>
                </li>
              ))}
            </TraceDisclosure>
          </div>
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
                  <h3 className="text-xs font-semibold">{profileLabel(revision.profile_id)}</h3>
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
                  <FlowArrow size={13} /> {t("team.workflow")}
                </dt>
                <dd className="mt-1 truncate" title={revision.workflow_ref.workflow_id}>
                  {revision.workflow_ref.workflow_id}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-[var(--color-text-muted)]">
                  <ShieldCheck size={13} /> {t("team.skills")}
                </dt>
                <dd className="mt-1 tabular-nums">
                  {revision.skill_refs.length} {t("team.revisions")} · outputs{" "}
                  {revision.expected_output_artifact_types.join(", ")}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-[var(--color-text-muted)]">
                  <Hammer size={13} /> {t("team.tools")}
                </dt>
                <dd className="mt-1 tabular-nums">
                  {revision.direct_tool_allowlist.length} {t("team.direct")} ·{" "}
                  {revision.direct_tool_allowlist.join(", ")}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TraceDisclosure({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <details className="border-b border-[var(--color-border-default)] px-4 py-3 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <summary className="cursor-pointer list-none text-[10px] font-semibold text-[var(--color-text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
        {title} · {count}
      </summary>
      <ul className="mt-3 space-y-3 text-[10px] text-[var(--color-text-secondary)]">{children}</ul>
    </details>
  );
}
