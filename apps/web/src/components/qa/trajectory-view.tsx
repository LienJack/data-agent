"use client";

import type { PublicRunEvent } from "@data-agent/contracts";
import { useEffect, useMemo } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { groupTrajectoryEvents } from "@/lib/qa-event-assembler";
import {
  useQAActiveConversationId,
  useQAEvents,
  useQAMessages,
  useQAStore,
  useQATrajectoryFocus,
} from "@/lib/qa-store";

function eventLabel(event: PublicRunEvent): string {
  switch (event.type) {
    case "lifecycle":
      return event.payload.summary;
    case "progress":
      return `${event.payload.title} · ${event.payload.summary}`;
    case "tool":
      return `${event.payload.tool_name} · ${event.payload.summary}`;
    case "answer":
      return event.payload.delta;
    case "terminal":
      return event.payload.summary;
  }
}

function durationLabel(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function TrajectoryView() {
  const conversationId = useQAActiveConversationId();
  const events = useQAEvents();
  const messages = useQAMessages();
  const focus = useQATrajectoryFocus();
  const openConversation = useQAStore((state) => state.openConversation);
  const groups = useMemo(() => groupTrajectoryEvents(events), [events]);
  const toolCalls = groups.reduce((sum, group) => sum + group.toolCalls, 0);
  const duration = groups.reduce((sum, group) => sum + group.durationMs, 0);

  useEffect(() => {
    if (!focus) return;
    document
      .getElementById(`trajectory-${focus.runId}-${focus.sequence}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  if (!conversationId) {
    return <EmptyState title="选择一个对话" description="轨迹覆盖当前选中对话中的全部 Run" />;
  }
  if (groups.length === 0) {
    return <EmptyState title="暂无轨迹" description="发送消息后，执行事件会在这里按轮展示" />;
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-canvas)]">
      <div className="sticky top-0 z-10 grid grid-cols-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-5 py-3 text-xs">
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
      <div className="divide-y divide-[var(--color-border-default)]">
        {groups.map((group, turnIndex) => (
          <section key={group.runId} className="py-3">
            <header className="flex items-center gap-3 px-5 pb-2 text-xs text-[var(--color-text-muted)]">
              <span className="font-semibold text-[var(--color-text-secondary)]">
                Turn {turnIndex + 1}
              </span>
              <span className="font-mono">{group.runId.slice(0, 8)}</span>
              <span>{durationLabel(group.durationMs)}</span>
              <span>{group.toolCalls} calls</span>
            </header>
            <p className="truncate px-5 pb-2 text-xs text-[var(--color-text-secondary)]">
              {(() => {
                const agentIndex = messages.findIndex(
                  (message) => message.role === "agent" && message.runId === group.runId,
                );
                return (
                  messages
                    .slice(0, agentIndex < 0 ? messages.length : agentIndex)
                    .findLast((message) => message.role === "user")?.content ?? "用户问题"
                );
              })()}
            </p>
            <ol>
              {group.events.map((event) => {
                const selected = focus?.runId === event.run_id && focus.sequence === event.sequence;
                return (
                  <li
                    id={`trajectory-${event.run_id}-${event.sequence}`}
                    key={`${event.run_id}:${event.sequence}`}
                    className={
                      selected ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]" : ""
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        openConversation({ runId: event.run_id, sequence: event.sequence })
                      }
                      aria-label={`返回对话定位到 Run ${event.run_id} sequence ${event.sequence}`}
                      className="grid w-full grid-cols-[3.5rem_5.5rem_minmax(0,1fr)] gap-3 border-t border-[var(--color-border-default)] px-5 py-2 text-left text-xs outline-none hover:bg-[var(--color-bg-tertiary)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
                    >
                      <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                        #{event.sequence}
                      </span>
                      <span className="w-fit rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 font-semibold uppercase text-[10px] text-[var(--color-text-secondary)]">
                        {event.type}
                      </span>
                      <span
                        className="truncate text-[var(--color-text-secondary)]"
                        title={eventLabel(event)}
                      >
                        {eventLabel(event)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
