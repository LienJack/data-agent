"use client";

import type { ResolutionTrace, ResolutionTraceNode, SqlHistoryEntry } from "@data-agent/contracts";
import {
  ArrowSquareOut,
  BracketsCurly,
  Clock,
  FileText,
  GitBranch,
  Robot,
  Table,
} from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AgentTeamTrace } from "@/components/qa/agent-team-trace";
import { EmptyState } from "@/components/ui/empty-state";
import {
  fetchAgentProfiles,
  fetchAgentTeamTrace,
  fetchResolutionTrace,
  fetchSqlHistory,
} from "@/lib/api-client";
import { useQAActiveConversationId, useQAEvents, useQATrajectoryFocus } from "@/lib/qa-store";

type TraceTab = "overview" | "team" | "trace" | "sql" | "artifacts";
type LoadState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly trace: ResolutionTrace;
      readonly sql: readonly SqlHistoryEntry[];
      readonly profiles: Awaited<ReturnType<typeof fetchAgentProfiles>>;
      readonly teamTrace: Awaited<ReturnType<typeof fetchAgentTeamTrace>>;
      readonly teamError: string | null;
    };

const tabs: readonly {
  readonly id: TraceTab;
  readonly label: string;
  readonly icon: typeof GitBranch;
}[] = [
  { id: "overview", label: "概览", icon: Clock },
  { id: "trace", label: "轨迹", icon: GitBranch },
  { id: "team", label: "Team", icon: Robot },
  { id: "sql", label: "SQL", icon: Table },
  { id: "artifacts", label: "工件", icon: FileText },
];

function statusClass(status: ResolutionTraceNode["status"]): string {
  if (status === "FAILED" || status === "CANCELLED") return "bg-red-500";
  if (status === "WAITING") return "bg-amber-500";
  if (status === "RUNNING" || status === "QUEUED") return "bg-sky-500";
  return "bg-emerald-500";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function Overview({ trace, sql }: { trace: ResolutionTrace; sql: readonly SqlHistoryEntry[] }) {
  const terminal = trace.nodes.findLast(({ kind }) => kind === "TERMINAL");
  return (
    <div className="grid gap-px bg-[var(--color-border-default)] sm:grid-cols-2 xl:grid-cols-4">
      {[
        ["运行状态", terminal?.status ?? "RUNNING"],
        ["轨迹节点", String(trace.nodes.length)],
        ["SQL 记录", String(sql.length)],
        ["配置版本", trace.config_ref ? `r${trace.config_ref.config_revision}` : "未绑定"],
      ].map(([label, value]) => (
        <div key={label} className="min-w-0 bg-[var(--color-bg-primary)] px-5 py-4">
          <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
          <p className="mt-1 truncate text-sm font-semibold">{value}</p>
        </div>
      ))}
    </div>
  );
}

function TraceList({
  nodes,
  focusedSequence = null,
}: {
  nodes: readonly ResolutionTraceNode[];
  focusedSequence?: number | null;
}) {
  const focusedNode = nodes.find((node) => node.sequence === focusedSequence);
  const [expanded, setExpanded] = useState<string | null>(
    focusedNode?.node_id ?? nodes.at(-1)?.node_id ?? null,
  );
  useEffect(() => {
    if (!focusedNode) return;
    setExpanded(focusedNode.node_id);
    document
      .getElementById(`resolution-trace-${focusedNode.node_id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedNode]);
  if (nodes.length === 0)
    return <EmptyState title="暂无运行节点" description="当前 Run 尚未提交公开事件或工件" />;
  return (
    <ol className="divide-y divide-[var(--color-border-default)]">
      {nodes.map((node) => (
        <li
          key={node.node_id}
          id={`resolution-trace-${node.node_id}`}
          className={
            node.sequence === focusedSequence
              ? "bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
              : undefined
          }
        >
          <button
            type="button"
            aria-expanded={expanded === node.node_id}
            aria-current={node.sequence === focusedSequence ? "step" : undefined}
            onClick={() => setExpanded(expanded === node.node_id ? null : node.node_id)}
            className="grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3 text-left outline-none hover:bg-[var(--color-bg-tertiary)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
          >
            <span className={`mt-1.5 size-2 rounded-full ${statusClass(node.status)}`} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <strong className="text-xs">{node.title}</strong>
                <span className="text-[10px] text-[var(--color-text-muted)]">{node.kind}</span>
              </span>
              <span className="mt-1 block break-words text-[11px] leading-5 text-[var(--color-text-secondary)]">
                {expanded === node.node_id
                  ? node.summary
                  : `${node.summary.slice(0, 180)}${node.summary.length > 180 ? "..." : ""}`}
              </span>
              {expanded === node.node_id && (
                <span className="mt-2 block font-mono text-[10px] text-[var(--color-text-muted)]">
                  {node.source_event_id ? `event ${node.source_event_id}` : node.node_id}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap text-[10px] tabular-nums text-[var(--color-text-muted)]">
              {formatTime(node.occurred_at)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function SqlList({ entries }: { entries: readonly SqlHistoryEntry[] }) {
  if (entries.length === 0)
    return <EmptyState title="暂无 SQL 记录" description="当前 Run 尚未提交 SqlArtifact" />;
  return (
    <div className="w-full max-w-full overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
        <thead className="bg-[var(--color-bg-canvas)] text-[var(--color-text-muted)]">
          <tr>
            <th className="px-4 py-2 font-medium">状态</th>
            <th className="px-4 py-2 font-medium">Compiler</th>
            <th className="px-4 py-2 font-medium">Query hash</th>
            <th className="px-4 py-2 font-medium">时间</th>
            <th className="w-12 px-4 py-2" aria-label="打开会话" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-default)]">
          {entries.map((entry) => (
            <tr key={entry.entry_hash} className="hover:bg-[var(--color-bg-tertiary)]">
              <td className="px-4 py-3 font-semibold">{entry.status}</td>
              <td className="px-4 py-3">{entry.compiler_version}</td>
              <td className="max-w-[240px] truncate px-4 py-3 font-mono" title={entry.query_hash}>
                {entry.query_hash}
              </td>
              <td className="whitespace-nowrap px-4 py-3">{formatTime(entry.occurred_at)}</td>
              <td className="px-4 py-3">
                <a
                  href={entry.conversation_href}
                  aria-label="打开原会话"
                  title="打开原会话"
                  className="inline-flex size-7 items-center justify-center rounded-md hover:bg-[var(--color-bg-canvas)]"
                >
                  <ArrowSquareOut size={16} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArtifactList({ trace }: { trace: ResolutionTrace }) {
  const artifacts = useMemo(() => {
    const byIdentity = new Map<string, ResolutionTraceNode["artifact_refs"][number]>();
    for (const node of trace.nodes)
      for (const reference of node.artifact_refs)
        byIdentity.set(
          `${reference.artifact_id}:${reference.revision}:${reference.content_hash}`,
          reference,
        );
    return [...byIdentity.values()];
  }, [trace]);
  if (artifacts.length === 0)
    return <EmptyState title="暂无工件" description="当前轨迹没有公开 Artifact reference" />;
  return (
    <ul className="divide-y divide-[var(--color-border-default)]">
      {artifacts.map((reference) => (
        <li
          key={`${reference.artifact_id}:${reference.revision}`}
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-5 py-3"
        >
          <BracketsCurly className="mt-0.5 text-[var(--color-text-muted)]" size={18} />
          <div className="min-w-0">
            <p className="text-xs font-semibold">
              {reference.artifact_type}{" "}
              <span className="font-normal text-[var(--color-text-muted)]">
                r{reference.revision}
              </span>
            </p>
            <p
              className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]"
              title={reference.content_hash}
            >
              {reference.content_hash}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ResolutionTraceView() {
  const parameters = useParams<{ workspaceId?: string }>();
  const workspaceId = typeof parameters.workspaceId === "string" ? parameters.workspaceId : "";
  const conversationId = useQAActiveConversationId();
  const focus = useQATrajectoryFocus();
  const events = useQAEvents();
  const runId = focus?.runId ?? events.at(-1)?.run_id ?? null;
  const eventCursor = runId
    ? events.reduce(
        (latest, event) => (event.run_id === runId ? Math.max(latest, event.sequence) : latest),
        0,
      )
    : 0;
  const [state, setState] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    if (!workspaceId || !runId || !Number.isSafeInteger(eventCursor)) {
      setState({ status: "idle" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    const team = Promise.all([
      fetchAgentProfiles(workspaceId),
      fetchAgentTeamTrace(runId, workspaceId),
    ])
      .then(([profiles, teamTrace]) => ({ profiles, teamTrace, teamError: null }))
      .catch((error: unknown) => ({
        profiles: [],
        teamTrace: null,
        teamError: error instanceof Error ? error.message : "Agent Team 轨迹加载失败",
      }));
    void Promise.all([
      fetchResolutionTrace(runId, workspaceId),
      fetchSqlHistory({ runId, ...(conversationId ? { conversationId } : {}) }, workspaceId),
      team,
    ])
      .then(([trace, sql, teamState]) => {
        if (active) setState({ status: "ready", trace, sql: sql.items, ...teamState });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "轨迹加载失败",
          });
      });
    return () => {
      active = false;
    };
  }, [conversationId, eventCursor, runId, workspaceId]);

  if (!conversationId)
    return <EmptyState title="选择一个对话" description="轨迹覆盖当前选中对话中的全部 Run" />;
  if (!runId) return <EmptyState title="暂无轨迹" description="当前对话还没有持久化 Run" />;
  if (state.status === "loading" || state.status === "idle")
    return (
      <div className="p-5 text-xs text-[var(--color-text-muted)]" role="status">
        正在加载权威轨迹...
      </div>
    );
  if (state.status === "error")
    return (
      <div className="p-5 text-xs text-red-700" role="alert">
        {state.message}
      </div>
    );
  if (state.status !== "ready") return null;

  return (
    <ResolutionTracePanel
      trace={state.trace}
      sql={state.sql}
      focusSequence={focus?.sequence ?? null}
      profiles={state.profiles}
      teamTrace={state.teamTrace}
      teamError={state.teamError}
    />
  );
}

export function ResolutionTracePanel({
  trace,
  sql,
  profiles = [],
  teamTrace = null,
  teamError = null,
  initialTab = "trace",
  focusSequence = null,
}: {
  readonly trace: ResolutionTrace;
  readonly sql: readonly SqlHistoryEntry[];
  readonly profiles?: Awaited<ReturnType<typeof fetchAgentProfiles>>;
  readonly teamTrace?: Awaited<ReturnType<typeof fetchAgentTeamTrace>>;
  readonly teamError?: string | null;
  readonly initialTab?: TraceTab;
  readonly focusSequence?: number | null;
}) {
  const [tab, setTab] = useState<TraceTab>(initialTab);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-default)] px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">运行与证据</h2>
          <p className="truncate font-mono text-[10px] text-[var(--color-text-muted)]">
            {trace.run_id}
          </p>
        </div>
        <div className="flex items-center" aria-label="运行与证据视图" role="tablist">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              title={label}
              className={`inline-flex h-9 items-center gap-1.5 border-b-2 px-2 text-[11px] ${tab === id ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {tab === "overview" && <Overview trace={trace} sql={sql} />}
        {tab === "trace" && <TraceList nodes={trace.nodes} focusedSequence={focusSequence} />}
        {tab === "team" && (
          <AgentTeamTrace profiles={profiles} trace={teamTrace} error={teamError} />
        )}
        {tab === "sql" && <SqlList entries={sql} />}
        {tab === "artifacts" && <ArtifactList trace={trace} />}
      </div>
    </div>
  );
}
