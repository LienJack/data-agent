import type { PublicRunEvent } from "@data-agent/contracts";
import type { Message } from "./qa-types";

export interface ProcessRow {
  id: string;
  runId: string;
  sequence: number;
  kind: "progress" | "reasoning" | "tool";
  title: string;
  summary: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED";
  input: string | null;
  output: string | null;
  durationMs: number | null;
  toolName: string | null;
}

export interface TrajectoryRunGroup {
  runId: string;
  events: PublicRunEvent[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  toolCalls: number;
}

export type TrajectoryRole = "user" | "assistant" | "tool" | "system";

export interface TrajectoryRecord {
  id: string;
  runId: string;
  sequences: number[];
  sequence: number;
  turn: number;
  role: TrajectoryRole;
  eventType: string;
  label: string;
  summary: string;
  status: string;
  occurredAt: string;
  completedAt: string | null;
  durationMs: number | null;
  payload: unknown;
  result: unknown;
  schema: Readonly<{
    schema_version: string;
    event_type: string;
    role: TrajectoryRole;
    source: "qa_messages" | "run_events";
  }>;
}

export function mergePublicRunEvents(
  current: readonly PublicRunEvent[],
  incoming: readonly PublicRunEvent[],
): PublicRunEvent[] {
  const merged = new Map(current.map((event) => [`${event.run_id}:${event.sequence}`, event]));
  for (const event of incoming) merged.set(`${event.run_id}:${event.sequence}`, event);
  return [...merged.values()].sort(
    (left, right) =>
      left.occurred_at.localeCompare(right.occurred_at) ||
      left.run_id.localeCompare(right.run_id) ||
      left.sequence - right.sequence,
  );
}

export function answerText(events: readonly PublicRunEvent[], runId: string): string {
  return events
    .filter(
      (event): event is Extract<PublicRunEvent, { type: "answer" }> =>
        event.run_id === runId && event.type === "answer",
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => event.payload.delta)
    .join("");
}

export function assembleProcessRows(
  events: readonly PublicRunEvent[],
  runId: string,
): ProcessRow[] {
  const rows: ProcessRow[] = [];
  const tools = new Map<string, ProcessRow>();
  const reasoning = new Map<string, ProcessRow>();
  let terminalStatus: "COMPLETED" | "FAILED" | "CANCELLED" | null = null;
  for (const event of events
    .filter((candidate) => candidate.run_id === runId)
    .sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === "progress") {
      rows.push({
        id: `${runId}:${event.sequence}`,
        runId,
        sequence: event.sequence,
        kind: "progress",
        title: event.payload.title,
        summary: event.payload.summary,
        status: event.payload.status,
        input: null,
        output: null,
        durationMs: null,
        toolName: null,
      });
    }
    if (event.type === "tool") {
      const current = tools.get(event.payload.call_id);
      const next: ProcessRow = {
        id: `${runId}:${event.payload.call_id}`,
        runId,
        sequence: current?.sequence ?? event.sequence,
        kind: "tool",
        title: current?.title ?? event.payload.title,
        summary: event.payload.summary,
        status: event.payload.status,
        input: event.payload.input ?? current?.input ?? null,
        output: event.payload.output ?? current?.output ?? null,
        durationMs: event.payload.duration_ms ?? current?.durationMs ?? null,
        toolName: event.payload.tool_name,
      };
      tools.set(event.payload.call_id, next);
    }
    if (event.type === "reasoning") {
      const current = reasoning.get(event.payload.block_id);
      reasoning.set(event.payload.block_id, {
        id: `${runId}:reasoning:${event.payload.block_id}`,
        runId,
        sequence: current?.sequence ?? event.sequence,
        kind: "reasoning",
        title: event.payload.phase === "START" ? event.payload.title : (current?.title ?? "思考"),
        summary:
          event.payload.phase === "DELTA"
            ? `${current?.summary ?? ""}${event.payload.delta}`
            : event.payload.phase === "END"
              ? event.payload.summary
              : "正在思考…",
        status: event.payload.phase === "END" ? "COMPLETED" : "RUNNING",
        input: null,
        output: null,
        durationMs:
          event.payload.phase === "END" ? event.payload.duration_ms : (current?.durationMs ?? null),
        toolName: null,
      });
    }
    if (event.type === "terminal") terminalStatus = event.payload.status;
  }
  rows.push(
    ...[...tools.values()].map((tool) => {
      if (tool.status !== "RUNNING" || terminalStatus === null || terminalStatus === "COMPLETED") {
        return tool;
      }
      return {
        ...tool,
        status: terminalStatus === "CANCELLED" ? ("INTERRUPTED" as const) : ("FAILED" as const),
        summary:
          terminalStatus === "CANCELLED" ? "工具调用已随 Run 中断" : "工具调用未完成，Run 已失败",
      };
    }),
  );
  rows.push(
    ...[...reasoning.values()].map((row) => {
      if (row.status !== "RUNNING" || terminalStatus === null || terminalStatus === "COMPLETED") {
        return row;
      }
      return {
        ...row,
        status: terminalStatus === "CANCELLED" ? ("INTERRUPTED" as const) : ("FAILED" as const),
        summary:
          terminalStatus === "CANCELLED" ? "思考摘要已随 Run 中断" : "思考摘要未完成，Run 已失败",
      };
    }),
  );
  return rows.sort((left, right) => left.sequence - right.sequence);
}

export function groupTrajectoryEvents(events: readonly PublicRunEvent[]): TrajectoryRunGroup[] {
  const groups = new Map<string, PublicRunEvent[]>();
  for (const event of events) {
    const group = groups.get(event.run_id) ?? [];
    group.push(event);
    groups.set(event.run_id, group);
  }
  return [...groups.entries()]
    .map(([runId, group]) => {
      group.sort((left, right) => left.sequence - right.sequence);
      const startedAt = group[0]?.occurred_at ?? new Date(0).toISOString();
      const completedAt = group.at(-1)?.occurred_at ?? startedAt;
      const toolCalls = new Set(
        group
          .filter(
            (event): event is Extract<PublicRunEvent, { type: "tool" }> => event.type === "tool",
          )
          .map((event) => event.payload.call_id),
      ).size;
      return {
        runId,
        events: group,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        toolCalls,
      };
    })
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function precedingUserMessage(messages: readonly Message[], runId: string): Message | undefined {
  const assistantIndex = messages.findIndex(
    (message) => message.role === "agent" && message.runId === runId,
  );
  return messages
    .slice(0, assistantIndex < 0 ? messages.length : assistantIndex)
    .findLast((message) => message.role === "user");
}

function terminalForRun(
  events: readonly PublicRunEvent[],
): Extract<PublicRunEvent, { type: "terminal" }> | undefined {
  return events.findLast(
    (event): event is Extract<PublicRunEvent, { type: "terminal" }> => event.type === "terminal",
  );
}

function schemaFor(
  role: TrajectoryRole,
  eventType: string,
  source: "qa_messages" | "run_events",
): TrajectoryRecord["schema"] {
  return {
    schema_version:
      source === "run_events" ? "public-run-event@1.0.0" : "workspace-conversation-message@1.0.0",
    event_type: eventType,
    role,
    source,
  };
}

/**
 * Project parsed messages and public Run events into the trajectory inspector ledger.
 * Tool boundaries are collapsed by call_id so Payload and Result stay on one record.
 */
export function buildTrajectoryRecords(
  events: readonly PublicRunEvent[],
  messages: readonly Message[],
): TrajectoryRecord[] {
  const records: TrajectoryRecord[] = [];
  const usedUserMessageIds = new Set<string>();

  for (const [turnIndex, group] of groupTrajectoryEvents(events).entries()) {
    const turn = turnIndex + 1;
    const firstSequence = group.events[0]?.sequence ?? 1;
    const terminal = terminalForRun(group.events);
    const userMessage = precedingUserMessage(messages, group.runId);

    if (userMessage && !usedUserMessageIds.has(userMessage.id)) {
      usedUserMessageIds.add(userMessage.id);
      records.push({
        id: `message:${userMessage.id}`,
        runId: group.runId,
        sequences: [firstSequence],
        sequence: firstSequence,
        turn,
        role: "user",
        eventType: "message.user",
        label: "用户消息",
        summary: userMessage.content,
        status: "COMPLETED",
        occurredAt: userMessage.createdAt,
        completedAt: userMessage.createdAt,
        durationMs: 0,
        payload: { content: userMessage.content, type: userMessage.type },
        result: null,
        schema: schemaFor("user", "message.user", "qa_messages"),
      });
    }

    for (const event of group.events) {
      if (event.type === "answer" || event.type === "reasoning" || event.type === "tool") continue;
      if (event.type === "progress") {
        records.push({
          id: `event:${event.run_id}:${event.sequence}`,
          runId: event.run_id,
          sequences: [event.sequence],
          sequence: event.sequence,
          turn,
          role: "assistant",
          eventType: "progress",
          label: event.payload.title,
          summary: event.payload.summary,
          status: event.payload.status,
          occurredAt: event.occurred_at,
          completedAt: event.payload.status === "COMPLETED" ? event.occurred_at : null,
          durationMs: null,
          payload: event.payload,
          result: event.payload.status === "COMPLETED" ? { summary: event.payload.summary } : null,
          schema: schemaFor("assistant", "progress", "run_events"),
        });
        continue;
      }

      const label = event.type === "terminal" ? "运行终态" : event.payload.name;
      records.push({
        id: `event:${event.run_id}:${event.sequence}`,
        runId: event.run_id,
        sequences: [event.sequence],
        sequence: event.sequence,
        turn,
        role: "system",
        eventType: event.type,
        label,
        summary: event.payload.summary,
        status: event.payload.status,
        occurredAt: event.occurred_at,
        completedAt: event.type === "terminal" ? event.occurred_at : null,
        durationMs: event.type === "terminal" ? group.durationMs : null,
        payload: event.payload,
        result:
          event.type === "terminal"
            ? { status: event.payload.status, error_code: event.payload.error_code }
            : null,
        schema: schemaFor("system", event.type, "run_events"),
      });
    }

    const toolEvents = group.events.filter(
      (event): event is Extract<PublicRunEvent, { type: "tool" }> => event.type === "tool",
    );
    const toolEventsByCall = new Map<string, typeof toolEvents>();
    for (const event of toolEvents) {
      const call = toolEventsByCall.get(event.payload.call_id) ?? [];
      call.push(event);
      toolEventsByCall.set(event.payload.call_id, call);
    }
    for (const row of assembleProcessRows(group.events, group.runId).filter(
      (candidate) => candidate.kind === "tool",
    )) {
      const callEvents = toolEventsByCall.get(
        toolEvents.find((event) => event.sequence === row.sequence)?.payload.call_id ?? "",
      );
      if (!callEvents || callEvents.length === 0) continue;
      const started = callEvents[0];
      const completed = callEvents.at(-1);
      if (!started || !completed) continue;
      records.push({
        id: row.id,
        runId: row.runId,
        sequences: callEvents.map((event) => event.sequence),
        sequence: row.sequence,
        turn,
        role: "tool",
        eventType: "tool",
        label: row.toolName ?? row.title,
        summary: row.summary,
        status: row.status,
        occurredAt: started.occurred_at,
        completedAt: row.status === "RUNNING" ? null : completed.occurred_at,
        durationMs: row.durationMs,
        payload: {
          call_id: started.payload.call_id,
          tool_name: started.payload.tool_name,
          input: row.input,
        },
        result: {
          status: row.status,
          output: row.output,
          duration_ms: row.durationMs,
          error_code: completed.payload.error_code,
        },
        schema: schemaFor("tool", "tool", "run_events"),
      });
    }

    const reasoningEvents = group.events.filter(
      (event): event is Extract<PublicRunEvent, { type: "reasoning" }> =>
        event.type === "reasoning",
    );
    for (const row of assembleProcessRows(group.events, group.runId).filter(
      (candidate) => candidate.kind === "reasoning",
    )) {
      const blockId = row.id.slice(`${group.runId}:reasoning:`.length);
      const blockEvents = reasoningEvents.filter((event) => event.payload.block_id === blockId);
      const started = blockEvents[0];
      const completed = blockEvents.at(-1);
      if (!started || !completed) continue;
      records.push({
        id: row.id,
        runId: row.runId,
        sequences: blockEvents.map((event) => event.sequence),
        sequence: row.sequence,
        turn,
        role: "assistant",
        eventType: "reasoning",
        label: row.title,
        summary: row.summary,
        status: row.status,
        occurredAt: started.occurred_at,
        completedAt: row.status === "RUNNING" ? null : completed.occurred_at,
        durationMs: row.durationMs,
        payload: { block_id: blockId, visibility: "PUBLIC_SUMMARY_ONLY" },
        result:
          row.status === "COMPLETED" ? { summary: row.summary, duration_ms: row.durationMs } : null,
        schema: schemaFor("assistant", "reasoning", "run_events"),
      });
    }

    const answerEvents = group.events.filter(
      (event): event is Extract<PublicRunEvent, { type: "answer" }> => event.type === "answer",
    );
    const assistantMessage = messages.find(
      (message) => message.role === "agent" && message.runId === group.runId,
    );
    const answer =
      assistantMessage?.content ?? answerEvents.map((event) => event.payload.delta).join("");
    if (assistantMessage || answer.length > 0) {
      const anchor = answerEvents[0] ?? terminal ?? group.events.at(-1);
      if (anchor) {
        const assistantStatus = terminal?.payload.status ?? "RUNNING";
        records.push({
          id: `assistant:${group.runId}`,
          runId: group.runId,
          sequences:
            answerEvents.length > 0
              ? answerEvents.map((event) => event.sequence)
              : [anchor.sequence],
          sequence: anchor.sequence,
          turn,
          role: "assistant",
          eventType: "message.assistant",
          label: "助手消息",
          summary: answer || "正在生成回答…",
          status: assistantStatus,
          occurredAt: anchor.occurred_at,
          completedAt: terminal?.occurred_at ?? null,
          durationMs:
            terminal && answerEvents[0]
              ? Math.max(
                  0,
                  Date.parse(terminal.occurred_at) - Date.parse(answerEvents[0].occurred_at),
                )
              : null,
          payload: { delta_count: answerEvents.length },
          result: { content: answer, type: assistantMessage?.type ?? "text" },
          schema: schemaFor("assistant", "message.assistant", "qa_messages"),
        });
      }
    }
  }

  const roleOrder: Record<TrajectoryRole, number> = { user: 0, system: 1, assistant: 2, tool: 3 };
  return records.sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.turn - right.turn ||
      left.sequence - right.sequence ||
      roleOrder[left.role] - roleOrder[right.role],
  );
}
