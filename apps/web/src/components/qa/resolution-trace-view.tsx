"use client";

import type {
  ArtifactReference,
  ResolutionTrace,
  ResolutionTraceDetail,
  ResolutionTraceDetailSection,
  ResolutionTraceNode,
  SqlHistoryEntry,
} from "@data-agent/contracts";
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
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentTeamTrace } from "@/components/qa/agent-team-trace";
import { EmptyState } from "@/components/ui/empty-state";
import { ArtifactPreviewPanel } from "@/components/workbench/artifact-preview-panel";
import {
  ApiRequestError,
  fetchAgentProfiles,
  fetchAgentTeamTrace,
  fetchResolutionTrace,
  fetchResolutionTraceDetail,
  fetchSqlHistory,
} from "@/lib/api-client";
import {
  type ObservedModelRequestPerformance,
  orderedConversationRunIds,
  readModelRequestPerformances,
} from "@/lib/model-request-performance";
import {
  useQAActiveConversationId,
  useQAConnection,
  useQAEvents,
  useQATrajectoryFocus,
} from "@/lib/qa-store";
import {
  buildConversationResolutionTraceWorkbenchModel,
  projectTimelineRecords,
  type ResolutionTraceLane,
  type ResolutionTraceWorkbenchRecord,
  resolveResolutionTraceRefresh,
} from "@/lib/resolution-trace-workbench";
import type { RunConnectionState } from "@/lib/run-projection";

type TraceTab = "overview" | "team" | "trace" | "sql" | "artifacts";
export type ResolutionTraceRequestIdentity = {
  readonly workspaceId: string;
  readonly runId: string;
};

type LoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly request: ResolutionTraceRequestIdentity }
  | {
      readonly status: "empty" | "error";
      readonly request: ResolutionTraceRequestIdentity;
      readonly message: string;
    }
  | {
      readonly status: "ready";
      readonly request: ResolutionTraceRequestIdentity;
      readonly trace: ResolutionTrace;
      readonly traces: readonly ResolutionTrace[];
      readonly sql: readonly SqlHistoryEntry[];
      readonly profiles: Awaited<ReturnType<typeof fetchAgentProfiles>>;
      readonly teamTrace: Awaited<ReturnType<typeof fetchAgentTeamTrace>>;
      readonly teamError: string | null;
    };

const authoritativeTraceFailureCodes = new Set([
  "AGENT_TEAM_TRACE_CORRUPT",
  "RUN_EVENT_STORE_EVENT_CORRUPT",
  "RUN_EVENT_STORE_PROJECTION_CORRUPT",
  "RUN_EVENT_STORE_RECEIPT_CORRUPT",
  "RUN_EVENT_STORE_SNAPSHOT_CORRUPT",
  "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
  "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING",
  "RESOLUTION_TRACE_AUTHORITY_CORRUPT",
  "RESOLUTION_TRACE_CONFIG_CORRUPT",
  "RESOLUTION_TRACE_CONFIG_MISSING",
  "RESOLUTION_TRACE_CONVERSATION_MISSING",
  "RESOLUTION_TRACE_EVENT_CORRUPT",
  "RESOLUTION_TRACE_EVENT_GAP",
  "RESOLUTION_TRACE_HASH_MISMATCH",
  "RESOLUTION_TRACE_NOT_FOUND_OR_DENIED",
  "RESOLUTION_TRACE_RESEARCH_ARTIFACT_NOT_COMMITTED",
  "RESOLUTION_TRACE_TOOL_IDENTITY_MISMATCH",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "轨迹加载失败";
}

function authoritativeTraceFailureCode(error: unknown): string | null {
  if (error instanceof ApiRequestError && error.code) {
    return authoritativeTraceFailureCodes.has(error.code) ? error.code : null;
  }
  if (error instanceof Error && authoritativeTraceFailureCodes.has(error.message)) {
    return error.message;
  }
  return null;
}

function sameResolutionTraceRequest(
  left: ResolutionTraceRequestIdentity,
  right: ResolutionTraceRequestIdentity,
): boolean {
  return left.workspaceId === right.workspaceId && left.runId === right.runId;
}

function stateMatchesResolutionTraceRequest(
  state: LoadState,
  request: ResolutionTraceRequestIdentity,
): boolean {
  return state.status !== "idle" && sameResolutionTraceRequest(state.request, request);
}

export function bindResolutionTraceLoadState(
  current: LoadState,
  request: ResolutionTraceRequestIdentity,
): LoadState {
  return stateMatchesResolutionTraceRequest(current, request)
    ? current
    : { status: "loading", request };
}

export function resolveResolutionTraceLoadFailure(
  current: LoadState,
  request: ResolutionTraceRequestIdentity,
  error: unknown,
): LoadState {
  if (!stateMatchesResolutionTraceRequest(current, request)) return current;
  const authorityCode = authoritativeTraceFailureCode(error);
  if (authorityCode) {
    return {
      status: "error",
      request,
      message: `权威轨迹已阻断：${errorMessage(error)}`,
    };
  }
  return current.status === "ready"
    ? current
    : {
        status: "error",
        request,
        message: errorMessage(error),
      };
}

type ResolutionTraceLoadResult = {
  readonly traces: readonly ResolutionTrace[];
  readonly sql: readonly SqlHistoryEntry[];
  readonly profiles: Awaited<ReturnType<typeof fetchAgentProfiles>>;
  readonly teamTrace: Awaited<ReturnType<typeof fetchAgentTeamTrace>>;
  readonly teamError: string | null;
};

export function resolveResolutionTraceLoadSuccess(
  current: LoadState,
  request: ResolutionTraceRequestIdentity,
  result: ResolutionTraceLoadResult,
): LoadState {
  if (!stateMatchesResolutionTraceRequest(current, request)) return current;
  const trace = result.traces.find((candidate) => candidate.run_id === request.runId);
  if (!trace) {
    return {
      status: "empty",
      request,
      message: "当前 Run 暂无权威轨迹",
    };
  }
  return {
    status: "ready",
    request,
    trace,
    traces: result.traces,
    sql: result.sql,
    profiles: result.profiles,
    teamTrace: result.teamTrace,
    teamError: result.teamError,
  };
}

async function fetchConversationResolutionTraces(
  runIds: readonly string[],
  workspaceId: string,
): Promise<readonly ResolutionTrace[]> {
  const traces: ResolutionTrace[] = [];
  for (let index = 0; index < runIds.length; index += 8) {
    traces.push(
      ...(await Promise.all(
        runIds.slice(index, index + 8).map((runId) => fetchResolutionTrace(runId, workspaceId)),
      )),
    );
  }
  return traces;
}

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
  if (["FAILED", "CANCELLED", "BLOCKED", "INTERRUPTED"].includes(status)) return "bg-red-500";
  if (status === "WAITING" || status === "PENDING") return "bg-amber-500";
  if (status === "RUNNING" || status === "QUEUED") return "bg-sky-500";
  return "bg-emerald-500";
}

function statusShapeClass(status: ResolutionTraceNode["status"]): string {
  if (["FAILED", "CANCELLED", "BLOCKED", "INTERRUPTED"].includes(status)) return "rotate-45";
  if (status === "WAITING" || status === "PENDING") return "rounded-none ring-1 ring-current";
  if (status === "RUNNING" || status === "QUEUED") return "rounded-full ring-2 ring-current";
  return "rounded-full";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value: number | null): string {
  if (value === null) return "耗时不可用";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} s`;
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

const laneLabels: Record<ResolutionTraceLane, string> = {
  RUN: "Run",
  AGENT: "Agent",
  TOOL: "Tools",
  EVIDENCE: "Evidence",
};

function referenceIdentity(reference: ArtifactReference): string {
  return `${reference.artifact_id}:${reference.revision}:${reference.content_hash}`;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function DetailSectionView({ section }: { section: ResolutionTraceDetailSection }) {
  if (section.state !== "AVAILABLE") {
    return (
      <div className="border-l-2 border-[var(--color-border-strong)] bg-[var(--color-bg-canvas)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
        <p>{section.message}</p>
        <code className="mt-1 block font-mono text-[9px] text-[var(--color-text-muted)]">
          {section.reason_code}
        </code>
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-2">
      {section.text !== null && (
        <pre className="reading-surface max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words border border-[var(--color-border-default)] p-3 font-mono text-[10px] leading-5">
          {section.text}
        </pre>
      )}
      {section.fields.length > 0 && (
        <dl className="grid min-w-0 grid-cols-[minmax(88px,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[10px]">
          {section.fields.map((field) => (
            <div key={`${field.label}:${field.value}`} className="contents">
              <dt className="text-[var(--color-text-muted)]">{field.label}</dt>
              <dd className="min-w-0 break-words text-[var(--color-text-primary)]">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

type DetailTab = "summary" | "payload" | "result" | "schema" | "timing";

function TraceInspector({
  node,
  detail,
  detailError,
  inspectorWidth,
  onInspectorWidthChange,
  onClose,
}: {
  node: ResolutionTraceNode;
  detail: ResolutionTraceDetail | null;
  detailError: string | null;
  inspectorWidth: number;
  onInspectorWidthChange(width: number): void;
  onClose(): void;
}) {
  const [tab, setTab] = useState<DetailTab>("summary");
  const [artifactIndex, setArtifactIndex] = useState(0);
  const references = detail?.artifact_refs ?? node.artifact_refs;
  const selectedReference = references[artifactIndex] ?? references[0] ?? null;
  const section = (title: string, content: ReactNode) => (
    <section className="border-b border-[var(--color-border-default)] px-4 py-3">
      <h4 className="mb-2 text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
        {title}
      </h4>
      {content}
    </section>
  );
  const unavailable = (
    <div
      className="px-4 py-5 text-[11px] text-[var(--color-text-muted)]"
      role={detailError ? "alert" : "status"}
    >
      {detailError ?? "正在加载公开详情…"}
    </div>
  );

  return (
    <aside
      className="glass-surface-strong relative flex min-h-0 min-w-0 flex-col border-l border-[var(--color-border-default)] max-lg:border-l-0 max-lg:border-t"
      aria-label="轨迹详情 Inspector"
    >
      <hr
        tabIndex={0}
        aria-label="调整轨迹详情宽度"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={620}
        aria-valuenow={inspectorWidth}
        onPointerDown={(event) => {
          const startX = event.clientX;
          const startWidth = inspectorWidth;
          const move = (pointerEvent: PointerEvent) =>
            onInspectorWidthChange(
              Math.min(620, Math.max(320, startWidth + startX - pointerEvent.clientX)),
            );
          const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop, { once: true });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onInspectorWidthChange(Math.min(620, inspectorWidth + 16));
          if (event.key === "ArrowRight")
            onInspectorWidthChange(Math.max(320, inspectorWidth - 16));
        }}
        className="absolute inset-y-0 -left-1 z-20 hidden w-2 cursor-col-resize outline-none focus-visible:bg-[var(--color-accent)] lg:block"
      />
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
            <span className="rounded border border-[var(--color-border-default)] px-1.5 py-0.5 font-mono">
              {node.kind}
            </span>
            <span>Step {node.sequence ?? "derived"}</span>
            <span>{node.status}</span>
          </p>
          <h3 className="mt-1 break-words text-sm font-semibold">{node.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭轨迹详情"
          title="关闭轨迹详情"
          className="size-7 shrink-0 rounded border border-[var(--color-border-default)] text-xs"
        >
          ×
        </button>
      </header>
      <div
        className="flex shrink-0 overflow-x-auto border-b border-[var(--color-border-default)] px-2"
        role="tablist"
      >
        {(["summary", "payload", "result", "schema", "timing"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => setTab(candidate)}
            className={`border-b-2 px-2 py-2 text-[10px] ${tab === candidate ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-text-muted)]"}`}
          >
            {candidate === "summary" ? "Summary" : candidate[0]?.toUpperCase() + candidate.slice(1)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!detail ? (
          unavailable
        ) : (
          <>
            {tab === "summary" && (
              <>
                {section(
                  "Hierarchy",
                  <dl className="space-y-2 break-words text-[10px]">
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Parents</dt>
                      <dd>
                        {detail.hierarchy.parent_node_ids.length > 0
                          ? detail.hierarchy.parent_node_ids.join(" → ")
                          : "Run root"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Children</dt>
                      <dd>{detail.hierarchy.child_node_ids.join(" · ") || "无"}</dd>
                    </div>
                  </dl>,
                )}
                {section("Status", <p className="text-xs font-semibold">{detail.status}</p>)}
                {section(
                  "Summary",
                  <p className="whitespace-pre-wrap break-words text-[10px] leading-5">
                    {detail.summary}
                  </p>,
                )}
                {section("Run 与对话", <DetailSectionView section={detail.run_context} />)}
                {section(
                  "Identity",
                  <dl className="space-y-2">
                    {detail.identity.map((item) => (
                      <div
                        key={`${item.label}:${item.value}`}
                        className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-[10px]"
                      >
                        <dt className="text-[var(--color-text-muted)]">{item.label}</dt>
                        <dd className="flex min-w-0 items-start gap-1">
                          <code className="min-w-0 flex-1 break-all">{item.value}</code>
                          <button
                            type="button"
                            aria-label={`复制 ${item.label}`}
                            title={`复制 ${item.label}`}
                            onClick={() => void navigator.clipboard?.writeText(item.value)}
                            className="shrink-0 rounded border border-[var(--color-border-default)] px-1 py-0.5 text-[8px]"
                          >
                            复制
                          </button>
                        </dd>
                      </div>
                    ))}
                  </dl>,
                )}
                {section("Payload", <DetailSectionView section={detail.payload} />)}
                {section("Result", <DetailSectionView section={detail.result} />)}
                {section(
                  "Schema",
                  detail.schema.state === "AVAILABLE" ? (
                    <p className="text-[10px]">
                      {detail.schema.schema_name} · {detail.schema.schema_version} ·{" "}
                      {detail.schema.fields.length} fields
                    </p>
                  ) : (
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {detail.schema.message} · {detail.schema.reason_code}
                    </p>
                  ),
                )}
                {section(
                  "Timing",
                  <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-[10px]">
                    <dt className="text-[var(--color-text-muted)]">Occurred</dt>
                    <dd>{formatTime(detail.timing.occurred_at)}</dd>
                    <dt className="text-[var(--color-text-muted)]">Duration</dt>
                    <dd>{formatDuration(detail.timing.duration_ms)}</dd>
                    <dt className="text-[var(--color-text-muted)]">Source</dt>
                    <dd>{detail.timing.source}</dd>
                  </dl>,
                )}
              </>
            )}
            {tab === "payload" &&
              section("Payload", <DetailSectionView section={detail.payload} />)}
            {tab === "result" && section("Result", <DetailSectionView section={detail.result} />)}
            {tab === "schema" &&
              section(
                "Schema",
                detail.schema.state === "AVAILABLE" ? (
                  <dl className="space-y-2 text-[10px]">
                    <div>
                      {detail.schema.schema_name} · {detail.schema.schema_version}
                    </div>
                    {detail.schema.fields.map((field) => (
                      <div key={field.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <code>{field.name}</code>
                        <span>{field.type}</span>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[10px]">
                    {detail.schema.message} · {detail.schema.reason_code}
                  </p>
                ),
              )}
            {tab === "timing" &&
              section(
                "Timing",
                <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 text-[10px]">
                  <dt>Occurred</dt>
                  <dd>{detail.timing.occurred_at}</dd>
                  <dt>Started</dt>
                  <dd>{detail.timing.started_at ?? "不可用"}</dd>
                  <dt>Completed</dt>
                  <dd>{detail.timing.completed_at ?? "不可用"}</dd>
                  <dt>Duration</dt>
                  <dd>{formatDuration(detail.timing.duration_ms)}</dd>
                  <dt>Timing source</dt>
                  <dd>{detail.timing.source}</dd>
                </dl>,
              )}
          </>
        )}
        {references.length > 0 &&
          (tab === "summary" || tab === "result") &&
          section(
            "Artifact 内容",
            <div className="space-y-3">
              {references.length > 1 && (
                <div className="flex max-w-full gap-1 overflow-x-auto">
                  {references.map((reference, index) => (
                    <button
                      key={referenceIdentity(reference)}
                      type="button"
                      onClick={() => setArtifactIndex(index)}
                      className={`shrink-0 rounded border px-2 py-1 text-[9px] ${index === artifactIndex ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border-default)]"}`}
                    >
                      {reference.artifact_type} r{reference.revision}
                    </button>
                  ))}
                </div>
              )}
              {selectedReference && (
                <>
                  <p className="text-[10px] font-medium">
                    {selectedReference.artifact_type} · revision {selectedReference.revision}
                  </p>
                  <ArtifactPreviewPanel
                    key={referenceIdentity(selectedReference)}
                    reference={selectedReference}
                    pageSize={100}
                  />
                </>
              )}
            </div>,
          )}
      </div>
    </aside>
  );
}

function TraceTimeline({
  records,
  selectedNodeId,
  matches,
  searchActive,
  durationMode,
  windowRange,
  onWindowRangeChange,
  onSelect,
}: {
  records: readonly ResolutionTraceWorkbenchRecord[];
  selectedNodeId: string | null;
  matches: ReadonlySet<string>;
  searchActive: boolean;
  durationMode: boolean;
  windowRange: readonly [number, number];
  onWindowRangeChange(range: readonly [number, number]): void;
  onSelect(nodeId: string): void;
}) {
  const domainStart = durationMode ? Math.min(...records.map(({ start_ms }) => start_ms)) : 1;
  const domainEnd = durationMode
    ? Math.max(...records.map(({ end_ms, start_ms }) => Math.max(end_ms, start_ms + 1)))
    : Math.max(1, records.length);
  const span = Math.max(1, domainEnd - domainStart);
  const dragStart = useRef<number | null>(null);
  const pointerRatio = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
  };
  const lanes = ["RUN", "AGENT", "TOOL", "EVIDENCE"] as const;
  const windowSpan = Math.max(0.02, windowRange[1] - windowRange[0]);
  const projectedRecords = useMemo(
    () => projectTimelineRecords(records, { selectedNodeId, matchNodeIds: matches }),
    [matches, records, selectedNodeId],
  );
  return (
    <div className="select-none border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)]">
      <div className="grid grid-cols-[64px_minmax(0,1fr)]">
        {lanes.map((lane) => (
          <div key={lane} className="contents">
            <div className="border-b border-r border-[var(--color-border-default)] px-2 py-2 text-[9px] font-medium uppercase text-[var(--color-text-muted)]">
              {laneLabels[lane]}
            </div>
            <div
              className="relative h-8 overflow-hidden border-b border-[var(--color-border-default)]"
              onPointerDown={(event) => {
                dragStart.current = pointerRatio(event);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                const end = pointerRatio(event);
                const start = dragStart.current;
                dragStart.current = null;
                if (start !== null && Math.abs(end - start) > 0.02)
                  onWindowRangeChange([Math.min(start, end), Math.max(start, end)]);
              }}
              onWheel={(event) => {
                event.preventDefault();
                const factor = event.deltaY > 0 ? 1.25 : 0.8;
                const nextSpan = Math.min(1, Math.max(0.04, windowSpan * factor));
                const center = (windowRange[0] + windowRange[1]) / 2;
                onWindowRangeChange([
                  Math.max(0, center - nextSpan / 2),
                  Math.min(1, center + nextSpan / 2),
                ]);
              }}
              onDoubleClick={() => onWindowRangeChange([0, 1])}
              role="application"
              aria-label={`${laneLabels[lane]} 时间轴，拖动选择区间，滚轮缩放，双击重置`}
            >
              {projectedRecords
                .filter((record) => record.lane === lane)
                .map((record) => {
                  const rawStart = durationMode
                    ? (record.start_ms - domainStart) / span
                    : (record.sequence_position - 1) / Math.max(1, records.length);
                  const rawEnd = durationMode
                    ? (Math.max(record.end_ms, record.start_ms + span * 0.004) - domainStart) / span
                    : rawStart + 1 / Math.max(1, records.length);
                  const left = ((rawStart - windowRange[0]) / windowSpan) * 100;
                  const width = Math.max(0.5, ((rawEnd - rawStart) / windowSpan) * 100);
                  if (left > 100 || left + width < 0) return null;
                  const matched = !searchActive || matches.has(record.node_id);
                  return (
                    <button
                      key={record.node_id}
                      type="button"
                      title={`${record.node.title} · ${record.node.kind} · ${record.node.status} · ${formatTime(record.node.occurred_at)} · ${formatDuration(record.node.duration_ms)} · sequence ${record.node.sequence ?? "derived"}`}
                      aria-label={`${record.node.title}，${record.node.status}，sequence ${record.node.sequence ?? "derived"}`}
                      onClick={() => onSelect(record.node_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") onWindowRangeChange([0, 1]);
                        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                          const next = records[records.indexOf(record) + 1];
                          if (next) onSelect(next.node_id);
                        }
                        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                          const previous = records[records.indexOf(record) - 1];
                          if (previous) onSelect(previous.node_id);
                        }
                      }}
                      className={`absolute top-2 h-4 min-w-1 border outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${statusShapeClass(record.node.status)} ${record.node_id === selectedNodeId ? "z-10 border-[var(--color-text-primary)] bg-[var(--color-accent)]" : `${statusClass(record.node.status)} border-transparent`} ${matched ? "opacity-100" : "opacity-15"}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      {projectedRecords.length < records.length && (
        <p className="px-2 py-1 text-[9px] text-[var(--color-text-muted)]">
          时间轴已聚合显示 {projectedRecords.length}/{records.length} 条；下方列表与搜索保留全部记录
        </p>
      )}
      {windowSpan < 0.999 && (
        <button
          type="button"
          onClick={() => onWindowRangeChange([0, 1])}
          className="m-2 rounded border border-[var(--color-border-default)] px-2 py-1 text-[9px]"
        >
          重置时间范围
        </button>
      )}
    </div>
  );
}

function TraceWorkbench({
  traces,
  focusedRunId = null,
  focusedSequence = null,
  workspaceId = "",
  initialDetails = [],
  connectionState = null,
  requestPerformances = [],
}: {
  traces: readonly ResolutionTrace[];
  focusedRunId?: string | null;
  focusedSequence?: number | null;
  workspaceId?: string;
  initialDetails?: readonly ResolutionTraceDetail[];
  connectionState?: RunConnectionState | null;
  requestPerformances?: readonly ObservedModelRequestPerformance[];
}) {
  const model = useMemo(() => buildConversationResolutionTraceWorkbenchModel(traces), [traces]);
  const focused = model.records.find(
    ({ node, run_id }) => run_id === focusedRunId && node.sequence === focusedSequence,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    focused?.node_id ?? model.records.at(-1)?.node_id ?? null,
  );
  const [query, setQuery] = useState("");
  const [durationMode, setDurationMode] = useState(true);
  const [timelineWindow, setTimelineWindow] = useState<readonly [number, number]>([0, 1]);
  const [stageDetailsExpanded, setStageDetailsExpanded] = useState(false);
  const [callDetailsExpanded, setCallDetailsExpanded] = useState(false);
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(
    () =>
      new Set(
        [...new Set(model.records.map(({ turn_index }) => turn_index))].filter(
          (turnIndex) => turnIndex !== (focused?.turn_index ?? model.records.at(-1)?.turn_index),
        ),
      ),
  );
  const [inspectorWidth, setInspectorWidth] = useState(420);
  const [scrollTop, setScrollTop] = useState(0);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  const [detail, setDetail] = useState<ResolutionTraceDetail | null>(
    initialDetails.find(({ node_id }) => node_id === (focused?.node_id ?? selectedNodeId)) ?? null,
  );
  const [detailError, setDetailError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailCache = useRef(
    new Map(
      initialDetails.map((candidate) => [
        `${focusedRunId ?? traces.at(-1)?.run_id}:${candidate.node_id}`,
        candidate,
      ]),
    ),
  );
  const traceHash = traces.map(({ trace_hash }) => trace_hash).join(":");
  const traceIdentity = useRef({ runId: focusedRunId, hash: traceHash });
  const previousRecords = useRef({
    count: model.records.length,
    lastNodeId: model.records.at(-1)?.node_id ?? null,
  });
  const rowTriggers = useRef(new Map<string, HTMLButtonElement>());
  const selectedRecord = model.records.find(({ node_id }) => node_id === selectedNodeId) ?? null;
  const selected = selectedRecord?.node ?? null;
  const runContextFields =
    detail?.run_context.state === "AVAILABLE" ? detail.run_context.fields : [];
  const runContextValue = (label: string) =>
    runContextFields.find((field) => field.label === label)?.value ?? null;
  const searchResults = useMemo(() => model.search(query), [model, query]);
  const matches = useMemo(
    () => new Set(searchResults.map(({ node_id }) => node_id)),
    [searchResults],
  );
  const candidateRecords = query.trim() ? searchResults : model.records;
  const filtered = candidateRecords.filter((record) => {
    if (timelineWindow[0] <= 0 && timelineWindow[1] >= 1) return true;
    if (durationMode) {
      const span = Math.max(1, model.real_time_domain.duration_ms);
      const start = (record.start_ms - model.real_time_domain.start_ms) / span;
      const end =
        (Math.max(record.end_ms, record.start_ms + 1) - model.real_time_domain.start_ms) / span;
      return end >= timelineWindow[0] && start <= timelineWindow[1];
    }
    const span = Math.max(1, model.records.length);
    const start = (record.sequence_position - 1) / span;
    const end = record.sequence_position / span;
    return end >= timelineWindow[0] && start <= timelineWindow[1];
  });
  const turnIndexes = useMemo(
    () => [...new Set(model.records.map(({ turn_index }) => turn_index))],
    [model.records],
  );
  const listItems = useMemo(
    () =>
      turnIndexes.flatMap((turnIndex) => {
        const allRecords = model.records.filter((record) => record.turn_index === turnIndex);
        const visibleRecords = filtered.filter((record) => record.turn_index === turnIndex);
        if (query.trim() && visibleRecords.length === 0) return [];
        return [
          { kind: "turn" as const, turnIndex, allRecords },
          ...(!collapsedTurns.has(turnIndex) || query.trim()
            ? visibleRecords.map((record) => ({ kind: "record" as const, record }))
            : []),
        ];
      }),
    [collapsedTurns, filtered, model.records, query, turnIndexes],
  );
  const rowHeight = 62;
  const virtual = listItems.length > 200;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowHeight) - 8) : 0;
  const end = virtual ? Math.min(listItems.length, start + 80) : listItems.length;
  const visible = listItems.slice(start, end);

  useEffect(() => {
    if (!focused) return;
    setSelectedNodeId(focused.node_id);
  }, [focused]);
  useEffect(() => {
    if (!selectedRecord || !collapsedTurns.has(selectedRecord.turn_index)) return;
    setCollapsedTurns((current) => {
      const next = new Set(current);
      next.delete(selectedRecord.turn_index);
      return next;
    });
  }, [collapsedTurns, selectedRecord]);
  useEffect(() => {
    if (traceIdentity.current.hash === traceHash) return;
    const runChanged = traceIdentity.current.runId !== focusedRunId;
    const refresh = resolveResolutionTraceRefresh({
      runChanged,
      focusedNodeId: focused?.node_id ?? null,
      selectedNodeId,
      selectedNodeStillExists: model.records.some(({ node_id }) => node_id === selectedNodeId),
      previousLastNodeId: previousRecords.current.lastNodeId,
      nextLastNodeId: model.records.at(-1)?.node_id ?? null,
      previousCount: previousRecords.current.count,
      nextCount: model.records.length,
    });
    traceIdentity.current = { runId: focusedRunId, hash: traceHash };
    detailCache.current.clear();
    for (const candidate of initialDetails)
      detailCache.current.set(
        `${focusedRunId ?? traces.at(-1)?.run_id}:${candidate.node_id}`,
        candidate,
      );
    const nextNodeId = refresh.selectedNodeId;
    setSelectedNodeId(nextNodeId ?? null);
    setDetail(initialDetails.find(({ node_id }) => node_id === nextNodeId) ?? null);
    setDetailError(null);
    if (refresh.resetView) {
      setQuery("");
      setTimelineWindow([0, 1]);
      setScrollTop(0);
      setPendingNewCount(0);
    } else if (refresh.appendedCount > 0 && !refresh.followedTail) {
      setPendingNewCount((current) => current + refresh.appendedCount);
    }
    previousRecords.current = {
      count: model.records.length,
      lastNodeId: model.records.at(-1)?.node_id ?? null,
    };
  }, [
    focused?.node_id,
    initialDetails,
    model.records,
    selectedNodeId,
    focusedRunId,
    traceHash,
    traces,
  ]);
  useEffect(() => {
    if (!selectedNodeId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    if (!selectedRecord) return;
    const cacheKey = `${selectedRecord.run_id}:${selectedRecord.node.node_id}`;
    const cached = detailCache.current.get(cacheKey);
    if (cached) {
      setDetail(cached);
      setDetailError(null);
      return;
    }
    if (!workspaceId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    void fetchResolutionTraceDetail(
      selectedRecord.run_id,
      selectedRecord.node.node_id,
      workspaceId,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          detailCache.current.set(cacheKey, value);
          setDetail(value);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setDetailError(error instanceof Error ? error.message : "公开详情加载失败");
      });
    return () => controller.abort();
  }, [selectedNodeId, selectedRecord, workspaceId]);
  useEffect(() => {
    if (!selectedNodeId) return;
    const index = listItems.findIndex(
      (item) => item.kind === "record" && item.record.node_id === selectedNodeId,
    );
    if (virtual && index >= 0) {
      const nextTop = Math.max(0, index * rowHeight - rowHeight * 3);
      listRef.current?.scrollTo({ top: nextTop, behavior: "smooth" });
      setScrollTop(nextTop);
      return;
    }
    document.getElementById(`resolution-trace-${selectedNodeId}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [listItems, selectedNodeId, virtual]);

  if (model.records.length === 0)
    return <EmptyState title="暂无运行节点" description="当前 Run 尚未提交公开事件或工件" />;
  const panTimeline = (direction: -1 | 1) => {
    const span = timelineWindow[1] - timelineWindow[0];
    const offset = span * 0.3 * direction;
    const nextStart = Math.min(1 - span, Math.max(0, timelineWindow[0] + offset));
    setTimelineWindow([nextStart, nextStart + span]);
  };
  const closeInspector = () => {
    const trigger = selectedNodeId ? rowTriggers.current.get(selectedNodeId) : null;
    setSelectedNodeId(null);
    requestAnimationFrame(() => trigger?.focus());
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border-default)] px-3 py-2 text-[10px]">
        {runContextFields.length > 0 && (
          <div className="mb-1 grid w-full min-w-0 gap-1 border-b border-[var(--color-border-default)] pb-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
            <div className="min-w-0">
              <p className="text-[9px] text-[var(--color-text-muted)]">用户问题</p>
              <p
                className="truncate text-[11px] font-medium"
                title={runContextValue("用户问题") ?? ""}
              >
                {runContextValue("用户问题")}
              </p>
            </div>
            {[
              ["Run 状态", runContextValue("Run 状态")],
              ["所属对话", runContextValue("所属对话")],
              ["冻结模型", runContextValue("冻结模型")],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <p className="text-[9px] text-[var(--color-text-muted)]">{label}</p>
                <p className="truncate" title={value ?? ""}>
                  {value ?? "不可用"}
                </p>
              </div>
            ))}
          </div>
        )}
        <span className="font-medium">{formatDuration(model.stats.duration_ms)}</span>
        <span>{model.stats.nodes} 节点</span>
        <span>{model.stats.calls} 调用</span>
        <span>{model.stats.failed_or_waiting} 失败/等待</span>
        <button
          type="button"
          onClick={() => setStageDetailsExpanded((value) => !value)}
          aria-pressed={stageDetailsExpanded}
          className="rounded border border-[var(--color-border-default)] px-2 py-1"
        >
          {stageDetailsExpanded ? "折叠阶段" : "展开阶段"}
        </button>
        <button
          type="button"
          onClick={() => setCallDetailsExpanded((value) => !value)}
          aria-pressed={callDetailsExpanded}
          className="rounded border border-[var(--color-border-default)] px-2 py-1"
        >
          {callDetailsExpanded ? "折叠调用" : "展开调用"}
        </button>
        {timelineWindow[1] - timelineWindow[0] < 0.999 && (
          <fieldset className="inline-flex items-center gap-1">
            <legend className="sr-only">平移时间范围</legend>
            <button
              type="button"
              onClick={() => panTimeline(-1)}
              className="rounded border border-[var(--color-border-default)] px-2 py-1"
              aria-label="时间范围向前平移"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => panTimeline(1)}
              className="rounded border border-[var(--color-border-default)] px-2 py-1"
              aria-label="时间范围向后平移"
            >
              →
            </button>
          </fieldset>
        )}
        <label className="ml-auto inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={durationMode}
            onChange={(event) => setDurationMode(event.currentTarget.checked)}
          />
          真实耗时
        </label>
        <label className="relative min-w-[160px] flex-1 sm:max-w-[280px]">
          <span className="sr-only">搜索公开轨迹</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索标题、摘要、状态、sequence"
            className="h-7 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>
        {query && <span>{filtered.length} 命中</span>}
        {pendingNewCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setSelectedNodeId(model.records.at(-1)?.node_id ?? null);
              setPendingNewCount(0);
            }}
            className="rounded border border-[var(--color-accent)] px-2 py-1 text-[var(--color-accent)]"
          >
            {pendingNewCount} 条新记录
          </button>
        )}
        {connectionState === "reconnecting" && (
          <span className="rounded border border-amber-500 px-2 py-1 text-amber-700" role="status">
            正在恢复轨迹连接；Run 状态保持不变
          </span>
        )}
      </div>
      <TraceTimeline
        records={model.records}
        selectedNodeId={selectedNodeId}
        matches={query ? matches : new Set()}
        searchActive={query.trim().length > 0}
        durationMode={durationMode}
        windowRange={timelineWindow}
        onWindowRangeChange={setTimelineWindow}
        onSelect={setSelectedNodeId}
      />
      <div
        className={`grid min-h-0 flex-1 ${selected ? "lg:grid-cols-[minmax(0,1fr)_var(--trace-inspector-width)]" : "grid-cols-1"}`}
        style={{ "--trace-inspector-width": `${inspectorWidth}px` } as React.CSSProperties}
      >
        <div
          ref={listRef}
          className="min-h-[240px] min-w-0 overflow-y-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <ol
            className="relative divide-y divide-[var(--color-border-default)]"
            style={virtual ? { height: listItems.length * rowHeight } : undefined}
          >
            {visible.map((item, visibleIndex) => {
              const positioning = virtual
                ? { top: (start + visibleIndex) * rowHeight, height: rowHeight }
                : undefined;
              if (item.kind === "turn") {
                const runId = item.allRecords[0]?.run_id ?? "";
                const terminal = item.allRecords.findLast(({ node }) => node.kind === "TERMINAL");
                const calls = item.allRecords.filter(({ node }) =>
                  ["TOOL", "SQL"].includes(node.kind),
                ).length;
                const duration = Math.max(
                  0,
                  Math.max(...item.allRecords.map(({ end_ms }) => end_ms)) -
                    Math.min(...item.allRecords.map(({ start_ms }) => start_ms)),
                );
                const requests = requestPerformances.filter((request) => request.run_id === runId);
                const collapsed = collapsedTurns.has(item.turnIndex) && !query.trim();
                return (
                  <li
                    key={`turn:${runId}`}
                    className={`border-l-2 border-l-[var(--color-border-strong)] bg-[var(--color-bg-canvas)] ${virtual ? "absolute inset-x-0" : ""}`}
                    style={positioning}
                  >
                    <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2">
                      <button
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() =>
                          setCollapsedTurns((current) => {
                            const next = new Set(current);
                            if (next.has(item.turnIndex)) next.delete(item.turnIndex);
                            else next.add(item.turnIndex);
                            return next;
                          })
                        }
                        className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            {collapsed ? "▸" : "▾"}
                          </span>
                          <strong className="text-[11px]">Turn {item.turnIndex + 1}</strong>
                          <span className="text-[9px] text-[var(--color-text-muted)]">
                            {terminal?.node.status ?? "RUNNING"}
                          </span>
                        </span>
                        <span className="mt-1 block truncate pl-5 text-[10px] text-[var(--color-text-secondary)]">
                          {terminal?.node.summary ?? item.allRecords[0]?.node.summary} ·{" "}
                          {item.allRecords.length} 节点 · {calls} 调用 · {formatDuration(duration)}
                        </span>
                      </button>
                      {requests.length > 0 && (
                        <details className="relative">
                          <summary className="cursor-pointer list-none rounded border border-[var(--color-border-default)] px-2 py-1 text-[9px] text-[var(--color-text-secondary)]">
                            Request {requests.length}
                          </summary>
                          <div className="surface-floating-strong absolute right-0 top-8 z-30 w-[330px] space-y-3 rounded-xl border border-[var(--color-border-default)] p-3 shadow-xl">
                            {requests.map(({ performance }, index) => (
                              <dl
                                key={performance.request_id}
                                className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-2 gap-y-1 border-b border-[var(--color-border-default)] pb-3 text-[9px] last:border-0 last:pb-0"
                              >
                                <dt className="font-semibold">Request {index + 1}</dt>
                                <dd className="truncate font-mono">{performance.request_id}</dd>
                                <dt>Provider / Model</dt>
                                <dd>
                                  {performance.provider}/{performance.model_id}
                                </dd>
                                <dt>Model Profile</dt>
                                <dd className="truncate font-mono">{performance.profile_id}</dd>
                                <dt>Status / Attempts</dt>
                                <dd>
                                  {performance.status} · {performance.attempt_count}
                                </dd>
                                <dt>Duration</dt>
                                <dd>{formatDuration(performance.duration_ms)}</dd>
                                <dt>Context ceiling</dt>
                                <dd>{performance.context_window_tokens.toLocaleString()} tokens</dd>
                                <dt>Context used</dt>
                                <dd>
                                  {performance.usage.availability === "AVAILABLE"
                                    ? `${Math.min(100, Math.round((performance.usage.input_tokens / performance.context_window_tokens) * 100))}%`
                                    : "不可用"}
                                </dd>
                                <dt>Reserved output</dt>
                                <dd>
                                  {performance.reserved_output_tokens.toLocaleString()} tokens
                                </dd>
                                <dt>Input / Output</dt>
                                <dd>
                                  {performance.usage.availability === "AVAILABLE"
                                    ? `${performance.usage.input_tokens.toLocaleString()} / ${performance.usage.output_tokens.toLocaleString()}`
                                    : "Provider usage unavailable"}
                                </dd>
                                <dt>Total / Tool calls</dt>
                                <dd>
                                  {performance.usage.availability === "AVAILABLE"
                                    ? `${performance.usage.total_tokens.toLocaleString()} / ${performance.usage.tool_calls}`
                                    : "不可用"}
                                </dd>
                                <dt>Token source</dt>
                                <dd>{performance.usage.source}</dd>
                                <dt>TTFT / Decoding</dt>
                                <dd>Provider 未提供</dd>
                              </dl>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </li>
                );
              }
              const record = item.record;
              return (
                <li
                  key={`${record.run_id}:${record.node_id}`}
                  id={`resolution-trace-${record.node_id}`}
                  className={`${selectedNodeId === record.node_id ? "border-l-2 border-l-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_7%,transparent)]" : "border-l-2 border-l-transparent"} ${virtual ? "absolute inset-x-0" : ""}`}
                  style={positioning}
                >
                  <button
                    ref={(element) => {
                      if (element) rowTriggers.current.set(record.node_id, element);
                      else rowTriggers.current.delete(record.node_id);
                    }}
                    type="button"
                    aria-current={selectedNodeId === record.node_id ? "step" : undefined}
                    onClick={() => setSelectedNodeId(record.node_id)}
                    className="grid h-full w-full grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-2 pl-7 text-left outline-none hover:bg-[var(--color-bg-tertiary)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
                  >
                    <span
                      className={`mt-1.5 size-2 ${statusShapeClass(record.node.status)} ${statusClass(record.node.status)}`}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-[11px]">{record.node.title}</strong>
                        <span className="text-[9px] text-[var(--color-text-muted)]">
                          {record.node.kind}
                        </span>
                        <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                          #{record.node.sequence ?? "derived"}
                        </span>
                      </span>
                      {(query.trim().length > 0 ||
                        !["PROGRESS", "REASONING", "AGENT"].includes(record.node.kind) ||
                        stageDetailsExpanded) &&
                        (query.trim().length > 0 ||
                          !["TOOL", "SQL"].includes(record.node.kind) ||
                          callDetailsExpanded) && (
                          <span className="mt-1 block truncate text-[10px] text-[var(--color-text-secondary)]">
                            {record.node.summary}
                          </span>
                        )}
                    </span>
                    <span className="whitespace-nowrap text-right font-mono text-[9px] text-[var(--color-text-muted)]">
                      {formatDuration(record.node.duration_ms)}
                      <br />
                      {new Date(record.node.occurred_at).toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {filtered.length === 0 && (
            <EmptyState title="没有匹配记录" description="请调整搜索关键词" />
          )}
        </div>
        {selected && (
          <TraceInspector
            key={selected.node_id}
            node={selected}
            detail={detail}
            detailError={detailError}
            inspectorWidth={inspectorWidth}
            onInspectorWidthChange={setInspectorWidth}
            onClose={closeInspector}
          />
        )}
      </div>
    </div>
  );
}

function SqlList({ entries }: { entries: readonly SqlHistoryEntry[] }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedReferenceIdentity, setSelectedReferenceIdentity] = useState<string | null>(null);
  const selected =
    entries.find(({ entry_hash }) => entry_hash === selectedHash) ?? entries[0] ?? null;
  const selectedReferences = selected
    ? [
        selected.sql_artifact_ref,
        selected.execution_receipt_ref,
        selected.query_evidence_ref,
        selected.result_ref,
        selected.schema_snapshot_ref,
      ].filter(isPresent)
    : [];
  const activeReference =
    selectedReferences.find(
      (reference) => referenceIdentity(reference) === selectedReferenceIdentity,
    ) ??
    selectedReferences[0] ??
    null;
  if (entries.length === 0)
    return <EmptyState title="暂无 SQL 记录" description="当前 Run 尚未提交 SqlArtifact" />;
  return (
    <div className="grid min-h-full min-w-0 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
      <div className="w-full max-w-full overflow-x-auto border-r border-[var(--color-border-default)]">
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
              <tr
                key={entry.entry_hash}
                className={
                  selected?.entry_hash === entry.entry_hash
                    ? "bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
                    : "hover:bg-[var(--color-bg-tertiary)]"
                }
              >
                <td className="px-4 py-3 font-semibold">{entry.status}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedHash(entry.entry_hash)}
                    className="text-left underline-offset-2 hover:underline"
                  >
                    {entry.compiler_version}
                  </button>
                </td>
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
      <div className="min-w-0 overflow-y-auto p-3">
        {selected && (
          <>
            <div className="mb-3">
              <h3 className="text-xs font-semibold">SQL 内容与证据</h3>
              <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                {selected.status} · {selected.compiler_version}
              </p>
            </div>
            <fieldset className="mb-3 flex max-w-full gap-1 overflow-x-auto">
              <legend className="sr-only">SQL 内容类型</legend>
              {selectedReferences.map((reference) => (
                <button
                  key={referenceIdentity(reference)}
                  type="button"
                  onClick={() => setSelectedReferenceIdentity(referenceIdentity(reference))}
                  className={`shrink-0 rounded border px-2 py-1 text-[9px] ${activeReference && referenceIdentity(activeReference) === referenceIdentity(reference) ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border-default)]"}`}
                >
                  {reference.artifact_type}
                </button>
              ))}
            </fieldset>
            {activeReference && (
              <ArtifactPreviewPanel
                key={referenceIdentity(activeReference)}
                reference={activeReference}
                pageSize={100}
              />
            )}
            <details className="mt-3 border-t border-[var(--color-border-default)] pt-2 text-[9px] text-[var(--color-text-muted)]">
              <summary className="cursor-pointer">身份与来源</summary>
              <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-1 font-mono">
                <dt>Query hash</dt>
                <dd className="break-all">{selected.query_hash}</dd>
                <dt>Statement hash</dt>
                <dd className="break-all">{selected.statement_hash}</dd>
                <dt>Parameter hash</dt>
                <dd className="break-all">{selected.parameter_hash}</dd>
                <dt>Schema hash</dt>
                <dd className="break-all">{selected.schema_snapshot_hash}</dd>
              </dl>
            </details>
          </>
        )}
      </div>
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
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const selected =
    artifacts.find((reference) => referenceIdentity(reference) === selectedIdentity) ??
    artifacts[0] ??
    null;
  if (artifacts.length === 0)
    return <EmptyState title="暂无工件" description="当前轨迹没有公开 Artifact reference" />;
  return (
    <div className="grid min-h-full min-w-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ul className="divide-y divide-[var(--color-border-default)] border-r border-[var(--color-border-default)]">
        {artifacts.map((reference) => (
          <li key={`${reference.artifact_id}:${reference.revision}`}>
            <button
              type="button"
              onClick={() => setSelectedIdentity(referenceIdentity(reference))}
              className={`grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 text-left ${selected && referenceIdentity(reference) === referenceIdentity(selected) ? "bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]" : "hover:bg-[var(--color-bg-tertiary)]"}`}
            >
              <BracketsCurly className="mt-0.5 text-[var(--color-text-muted)]" size={18} />
              <span className="min-w-0">
                <strong className="block text-xs">{reference.artifact_type}</strong>
                <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
                  revision {reference.revision} · 点击查看内容
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 overflow-y-auto p-3">
        {selected && (
          <ArtifactPreviewPanel
            key={referenceIdentity(selected)}
            reference={selected}
            pageSize={100}
          />
        )}
      </div>
    </div>
  );
}

export function ResolutionTraceView() {
  const parameters = useParams<{ workspaceId?: string }>();
  const workspaceId = typeof parameters.workspaceId === "string" ? parameters.workspaceId : "";
  const conversationId = useQAActiveConversationId();
  const focus = useQATrajectoryFocus();
  const events = useQAEvents();
  const connection = useQAConnection();
  const runIds = useMemo(() => orderedConversationRunIds(events), [events]);
  const runId =
    focus?.runId && runIds.includes(focus.runId) ? focus.runId : (runIds.at(-1) ?? null);
  const requestPerformances = useMemo(() => readModelRequestPerformances(events), [events]);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const request =
    workspaceId && runId ? ({ workspaceId, runId } satisfies ResolutionTraceRequestIdentity) : null;
  const visibleState = request ? bindResolutionTraceLoadState(state, request) : state;

  useEffect(() => {
    if (!workspaceId || !runId || runIds.length === 0) {
      setState({ status: "idle" });
      return;
    }
    const requestedIdentity = { workspaceId, runId } satisfies ResolutionTraceRequestIdentity;
    let active = true;
    setState((current) => bindResolutionTraceLoadState(current, requestedIdentity));
    const team = Promise.all([
      fetchAgentProfiles(workspaceId),
      fetchAgentTeamTrace(runId, workspaceId),
    ])
      .then(([profiles, teamTrace]) => ({ profiles, teamTrace, teamError: null }))
      .catch((error: unknown) => {
        if (authoritativeTraceFailureCode(error)) throw error;
        return {
          profiles: [],
          teamTrace: null,
          teamError: error instanceof Error ? error.message : "Agent Team 轨迹加载失败",
        };
      });
    void Promise.all([
      fetchConversationResolutionTraces(runIds, workspaceId),
      fetchSqlHistory({ runId, ...(conversationId ? { conversationId } : {}) }, workspaceId),
      team,
    ])
      .then(([traces, sql, teamState]) => {
        if (active) {
          setState((current) =>
            resolveResolutionTraceLoadSuccess(current, requestedIdentity, {
              traces,
              sql: sql.items,
              ...teamState,
            }),
          );
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState((current) =>
            resolveResolutionTraceLoadFailure(current, requestedIdentity, error),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId, runId, runIds, workspaceId]);

  if (!conversationId)
    return <EmptyState title="选择一个对话" description="轨迹覆盖当前选中对话中的全部 Run" />;
  if (!runId) return <EmptyState title="暂无轨迹" description="当前对话还没有持久化 Run" />;
  if (visibleState.status === "loading" || visibleState.status === "idle")
    return (
      <div className="p-5 text-xs text-[var(--color-text-muted)]" role="status">
        正在加载权威轨迹...
      </div>
    );
  if (visibleState.status === "empty") {
    return <EmptyState title="暂无轨迹" description={visibleState.message} />;
  }
  if (visibleState.status === "error")
    return (
      <div className="p-5 text-xs text-red-700" role="alert">
        {visibleState.message}
      </div>
    );
  if (visibleState.status !== "ready") return null;

  return (
    <ResolutionTracePanel
      trace={visibleState.trace}
      traces={visibleState.traces}
      sql={visibleState.sql}
      focusSequence={focus?.sequence ?? null}
      profiles={visibleState.profiles}
      teamTrace={visibleState.teamTrace}
      teamError={visibleState.teamError}
      workspaceId={workspaceId}
      connectionState={connection}
      requestPerformances={requestPerformances}
    />
  );
}

export function ResolutionTracePanel({
  trace,
  traces = [trace],
  sql,
  profiles = [],
  teamTrace = null,
  teamError = null,
  initialTab = "trace",
  focusSequence = null,
  workspaceId = "",
  initialDetails = [],
  connectionState = null,
  requestPerformances = [],
}: {
  readonly trace: ResolutionTrace;
  readonly traces?: readonly ResolutionTrace[];
  readonly sql: readonly SqlHistoryEntry[];
  readonly profiles?: Awaited<ReturnType<typeof fetchAgentProfiles>>;
  readonly teamTrace?: Awaited<ReturnType<typeof fetchAgentTeamTrace>>;
  readonly teamError?: string | null;
  readonly initialTab?: TraceTab;
  readonly focusSequence?: number | null;
  readonly workspaceId?: string;
  readonly initialDetails?: readonly ResolutionTraceDetail[];
  readonly connectionState?: RunConnectionState | null;
  readonly requestPerformances?: readonly ObservedModelRequestPerformance[];
}) {
  const [tab, setTab] = useState<TraceTab>(initialTab);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-default)] px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">运行与证据</h2>
          <p className="truncate font-mono text-[10px] text-[var(--color-text-muted)]">
            {traces.length} Turn · {trace.run_id}
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
        {tab === "trace" && (
          <TraceWorkbench
            traces={traces}
            focusedRunId={trace.run_id}
            focusedSequence={focusSequence}
            workspaceId={workspaceId}
            initialDetails={initialDetails}
            connectionState={connectionState}
            requestPerformances={requestPerformances}
          />
        )}
        {tab === "team" && (
          <AgentTeamTrace profiles={profiles} trace={teamTrace} error={teamError} />
        )}
        {tab === "sql" && <SqlList entries={sql} />}
        {tab === "artifacts" && <ArtifactList trace={trace} />}
      </div>
    </div>
  );
}
