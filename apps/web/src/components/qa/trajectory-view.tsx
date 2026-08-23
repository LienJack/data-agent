"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  buildTrajectoryRecords,
  groupTrajectoryEvents,
  type TrajectoryRecord,
  type TrajectoryRole,
} from "@/lib/qa-event-assembler";
import {
  useQAActiveConversationId,
  useQAEvents,
  useQAMessages,
  useQAStore,
  useQATrajectoryFocus,
} from "@/lib/qa-store";

const INSPECTOR_TABS = ["Summary", "Payload", "Result", "Schema", "Timing"] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number];

const ROLE_META: Record<
  TrajectoryRole,
  { label: string; badge: string; bar: string; dot: string }
> = {
  user: {
    label: "USER",
    badge: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
    bar: "bg-sky-500",
    dot: "bg-sky-500",
  },
  assistant: {
    label: "ASSISTANT",
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
    bar: "bg-violet-500",
    dot: "bg-violet-500",
  },
  tool: {
    label: "TOOL",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
  },
  system: {
    label: "SYSTEM",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
};

function durationLabel(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
}

function recordedTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function compactText(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function JsonBlock({ value, empty }: { value: unknown; empty: string }) {
  if (value === null || value === undefined) {
    return <p className="p-4 text-xs text-[var(--color-text-muted)]">{empty}</p>;
  }
  return (
    <pre className="max-h-[calc(100vh-20rem)] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[11px] leading-5 text-[var(--color-text-secondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function RoleBadge({ role }: { role: TrajectoryRole }) {
  const meta = ROLE_META[role];
  return (
    <span
      className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

function Timeline({
  records,
  selectedId,
  onSelect,
}: {
  records: readonly TrajectoryRecord[];
  selectedId: string;
  onSelect: (record: TrajectoryRecord) => void;
}) {
  const lanes: readonly TrajectoryRole[] = ["user", "assistant", "tool", "system"];
  const firstRecord = records[0];
  if (!firstRecord) return null;
  const spanDuration = (record: TrajectoryRecord) =>
    record.role === "tool" || record.eventType === "message.assistant"
      ? (record.durationMs ?? 0)
      : 0;
  const timestamps = records.map((record) => Date.parse(record.occurredAt));
  const minimum = Math.min(...timestamps);
  const maximum = Math.max(
    ...records.map((record) => Date.parse(record.occurredAt) + spanDuration(record)),
  );
  const domain = Math.max(1, maximum - minimum);
  const selectedIndex = Math.max(
    0,
    records.findIndex((record) => record.id === selectedId),
  );
  const selected = records[selectedIndex] ?? firstRecord;
  const selectedTimestamp = Date.parse(selected.occurredAt);
  const sliderValue =
    maximum === minimum
      ? Math.round((selectedIndex / Math.max(1, records.length - 1)) * 1000)
      : Math.round(((selectedTimestamp - minimum) / domain) * 1000);

  const selectNearest = (value: number) => {
    if (maximum === minimum) {
      const record = records[Math.round((value / 1000) * Math.max(0, records.length - 1))];
      if (record) onSelect(record);
      return;
    }
    const target = minimum + (value / 1000) * domain;
    let nearest = firstRecord;
    let distance = Number.POSITIVE_INFINITY;
    for (const record of records) {
      const midpoint = Date.parse(record.occurredAt) + (record.durationMs ?? 0) / 2;
      const nextDistance = Math.abs(midpoint - target);
      if (nextDistance < distance) {
        nearest = record;
        distance = nextDistance;
      }
    }
    onSelect(nearest);
  };

  return (
    <section className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-5 py-3">
      <div className="mb-2 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
        <span>{recordedTimeLabel(firstRecord.occurredAt)}</span>
        <span>拖动时间轴查看对应内容</span>
        <span>{recordedTimeLabel(records.at(-1)?.occurredAt ?? firstRecord.occurredAt)}</span>
      </div>
      <div className="relative rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5">
        <div className="space-y-1">
          {lanes.map((lane) => (
            <div key={lane} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="text-[9px] font-medium text-[var(--color-text-muted)]">
                {ROLE_META[lane].label}
              </span>
              <div className="relative h-3 overflow-hidden rounded-sm bg-[var(--color-bg-tertiary)]">
                {records
                  .filter((record) => record.role === lane)
                  .map((record) => {
                    const started = Date.parse(record.occurredAt);
                    const left = ((started - minimum) / domain) * 100;
                    const width = Math.max(0.75, (spanDuration(record) / domain) * 100);
                    const style = {
                      left: `${Math.min(99.25, Math.max(0, left))}%`,
                      width: `${Math.min(100 - left, width)}%`,
                    } satisfies CSSProperties;
                    return (
                      <button
                        key={record.id}
                        type="button"
                        style={style}
                        title={`${ROLE_META[record.role].label} · ${record.label}`}
                        aria-label={`选择 ${ROLE_META[record.role].label} ${record.label}`}
                        onClick={() => onSelect(record)}
                        className={`absolute inset-y-0 min-w-1 rounded-sm ${ROLE_META[record.role].bar} ${record.id === selectedId ? "z-10 ring-2 ring-[var(--color-text-primary)] ring-offset-1" : "opacity-75 hover:opacity-100"}`}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={sliderValue}
          onChange={(event) => selectNearest(Number(event.currentTarget.value))}
          aria-label="轨迹时间轴"
          className="mt-2 h-1.5 w-full cursor-ew-resize accent-[var(--color-accent)]"
        />
      </div>
    </section>
  );
}

function RecordList({
  records,
  selectedId,
  onSelect,
}: {
  records: readonly TrajectoryRecord[];
  selectedId: string;
  onSelect: (record: TrajectoryRecord) => void;
}) {
  const turns = new Map<number, TrajectoryRecord[]>();
  for (const record of records) {
    const turn = turns.get(record.turn) ?? [];
    turn.push(record);
    turns.set(record.turn, turn);
  }
  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-primary)]">
      {[...turns.entries()].map(([turn, turnRecords]) => (
        <section key={turn} className="border-b border-[var(--color-border-default)] py-2">
          <header className="flex items-center gap-3 px-5 py-1.5 text-[10px] text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text-secondary)]">Turn {turn}</span>
            <span className="font-mono">{turnRecords[0]?.runId.slice(0, 8)}</span>
            <span>{turnRecords.length} 条记录</span>
          </header>
          <ol>
            {turnRecords.map((record) => (
              <li key={record.id} id={`trajectory-record-${record.id}`} className="scroll-m-32">
                <button
                  type="button"
                  aria-pressed={record.id === selectedId}
                  onClick={() => onSelect(record)}
                  className={`grid w-full grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-3 border-t border-[var(--color-border-default)] px-5 py-2.5 text-left outline-none transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)] ${record.id === selectedId ? "border-l-2 border-l-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_9%,transparent)]" : ""}`}
                >
                  <RoleBadge role={record.role} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-[var(--color-text-primary)]">
                        {record.label}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${ROLE_META[record.role].dot}`}
                      />
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-muted)]">
                      {compactText(record.summary)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                    <span className="block">#{record.sequence}</span>
                    <span className="mt-0.5 block">{durationLabel(record.durationMs)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Inspector({ record }: { record: TrajectoryRecord }) {
  const [tab, setTab] = useState<InspectorTab>("Summary");
  const openConversation = useQAStore((state) => state.openConversation);

  return (
    <aside className="flex h-full min-h-0 flex-col border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] lg:border-t-0 lg:border-l">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RoleBadge role={record.role} />
            <span className="text-[10px] text-[var(--color-text-muted)]">
              Turn {record.turn} · Step {record.sequence}
            </span>
          </div>
          <p className="mt-1 truncate text-xs font-semibold text-[var(--color-text-primary)]">
            {record.label}
          </p>
        </div>
        <button
          type="button"
          onClick={() => openConversation({ runId: record.runId, sequence: record.sequence })}
          className="shrink-0 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          返回对话
        </button>
      </header>
      <div
        role="tablist"
        aria-label="轨迹详情"
        className="flex shrink-0 overflow-x-auto border-b border-[var(--color-border-default)] px-2"
      >
        {INSPECTOR_TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => setTab(candidate)}
            className={`border-b-2 px-2.5 py-2 text-[11px] ${tab === candidate ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
          >
            {candidate}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "Summary" && (
          <div className="space-y-4 p-4 text-xs">
            <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
              <dt className="text-[var(--color-text-muted)]">Hierarchy</dt>
              <dd className="text-[var(--color-text-secondary)]">
                Turn {record.turn} › {ROLE_META[record.role].label}
              </dd>
              <dt className="text-[var(--color-text-muted)]">Status</dt>
              <dd className="font-medium text-[var(--color-text-primary)]">{record.status}</dd>
              <dt className="text-[var(--color-text-muted)]">Run</dt>
              <dd className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
                {record.runId}
              </dd>
              <dt className="text-[var(--color-text-muted)]">Sequence</dt>
              <dd className="font-mono text-[var(--color-text-secondary)]">
                {record.sequences.join(", ") || record.sequence}
              </dd>
            </dl>
            <section>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Summary
              </h3>
              <p className="whitespace-pre-wrap leading-5 text-[var(--color-text-secondary)]">
                {record.summary}
              </p>
            </section>
          </div>
        )}
        {tab === "Payload" && <JsonBlock value={record.payload} empty="该记录没有公开载荷" />}
        {tab === "Result" && <JsonBlock value={record.result} empty="该记录尚未产生结果" />}
        {tab === "Schema" && <JsonBlock value={record.schema} empty="该记录没有结构信息" />}
        {tab === "Timing" && (
          <JsonBlock
            value={{
              started_at: record.occurredAt,
              completed_at: record.completedAt,
              duration_ms: record.durationMs,
              timing_source:
                record.schema.source === "run_events" ? "持久化 Run 时间戳" : "对话消息时间戳",
            }}
            empty="该记录没有时间信息"
          />
        )}
      </div>
    </aside>
  );
}

export function TrajectoryView() {
  const conversationId = useQAActiveConversationId();
  const events = useQAEvents();
  const messages = useQAMessages();
  const focus = useQATrajectoryFocus();
  const records = useMemo(() => buildTrajectoryRecords(events, messages), [events, messages]);
  const groups = useMemo(() => groupTrajectoryEvents(events), [events]);
  const toolCalls = groups.reduce((sum, group) => sum + group.toolCalls, 0);
  const duration = groups.reduce((sum, group) => sum + group.durationMs, 0);
  const [selectedId, setSelectedId] = useState("");
  const selected = records.find((record) => record.id === selectedId) ?? records.at(-1);

  useEffect(() => {
    const focused = focus
      ? records.find(
          (record) => record.runId === focus.runId && record.sequences.includes(focus.sequence),
        )
      : undefined;
    if (focused) {
      setSelectedId(focused.id);
      return;
    }
    setSelectedId((current) =>
      records.some((record) => record.id === current) ? current : (records.at(-1)?.id ?? ""),
    );
  }, [focus, records]);

  useEffect(() => {
    if (!selectedId) return;
    document
      .getElementById(`trajectory-record-${selectedId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

  if (!conversationId) {
    return <EmptyState title="选择一个对话" description="轨迹覆盖当前选中对话中的全部 Run" />;
  }
  if (records.length === 0) {
    return <EmptyState title="暂无轨迹" description="发送消息后，执行事件会在这里按轮展示" />;
  }

  const select = (record: TrajectoryRecord) => setSelectedId(record.id);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <div className="grid shrink-0 grid-cols-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-5 py-2.5 text-xs">
        <div>
          <span className="text-[var(--color-text-muted)]">Duration</span>
          <strong className="ml-2 tabular-nums">{durationLabel(duration)}</strong>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Turns</span>
          <strong className="ml-2 tabular-nums">{groups.length}</strong>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Calls</span>
          <strong className="ml-2 tabular-nums">{toolCalls}</strong>
        </div>
      </div>
      <Timeline records={records} selectedId={selected?.id ?? ""} onSelect={select} />
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(16rem,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,36%)] lg:grid-rows-1">
        <RecordList records={records} selectedId={selected?.id ?? ""} onSelect={select} />
        {selected ? <Inspector key={selected.id} record={selected} /> : null}
      </div>
    </div>
  );
}
