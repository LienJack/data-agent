import type { PublicRunEvent } from "@data-agent/contracts";

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
