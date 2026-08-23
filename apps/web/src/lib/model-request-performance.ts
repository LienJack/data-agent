import {
  MODEL_REQUEST_TOOL_NAME,
  type ModelRequestPerformance,
  modelRequestPerformanceSchema,
  type PublicRunEvent,
} from "@data-agent/contracts";

export interface ObservedModelRequestPerformance {
  readonly run_id: string;
  readonly sequence: number;
  readonly occurred_at: string;
  readonly performance: ModelRequestPerformance;
}

export function orderedConversationRunIds(events: readonly PublicRunEvent[]): readonly string[] {
  const firstSeen = new Map<string, number>();
  for (const event of events) {
    const occurredAt = Date.parse(event.occurred_at);
    const current = firstSeen.get(event.run_id);
    if (current === undefined || occurredAt < current) firstSeen.set(event.run_id, occurredAt);
  }
  return [...firstSeen]
    .sort(([leftId, leftTime], [rightId, rightTime]) =>
      leftTime === rightTime ? leftId.localeCompare(rightId) : leftTime - rightTime,
    )
    .map(([runId]) => runId);
}

export function contextWindowOccupancy(performance: ModelRequestPerformance | null) {
  if (performance?.usage.availability !== "AVAILABLE") return null;
  const used = performance.usage.input_tokens;
  const capacity = performance.context_window_tokens;
  return {
    used,
    capacity,
    percent: Math.min(100, Math.round((used / capacity) * 100)),
    usage: performance.usage,
  } as const;
}

export function readModelRequestPerformances(
  events: readonly PublicRunEvent[],
): readonly ObservedModelRequestPerformance[] {
  return events.flatMap((event): readonly ObservedModelRequestPerformance[] => {
    if (
      event.type !== "tool" ||
      event.payload.status !== "COMPLETED" ||
      event.payload.tool_name !== MODEL_REQUEST_TOOL_NAME ||
      event.payload.output === null
    ) {
      return [];
    }
    try {
      const performance = modelRequestPerformanceSchema.parse(JSON.parse(event.payload.output));
      if (performance.request_id !== event.payload.call_id) return [];
      return [
        {
          run_id: event.run_id,
          sequence: event.sequence,
          occurred_at: event.occurred_at,
          performance,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function latestExactContextUsage(
  events: readonly PublicRunEvent[],
  profileId: string | null | undefined,
): ObservedModelRequestPerformance | null {
  if (!profileId) return null;
  return (
    readModelRequestPerformances(events).findLast(
      ({ performance }) =>
        performance.profile_id === profileId && performance.usage.availability === "AVAILABLE",
    ) ?? null
  );
}
