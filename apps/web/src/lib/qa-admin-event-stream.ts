import type { QaAdminRunEventsPage } from "@data-agent/contracts";
import { qaAdminRunEventsPageSchema } from "@data-agent/contracts";

export function mergeAdminRunEventsPage(
  current: QaAdminRunEventsPage | null,
  replay: QaAdminRunEventsPage,
): QaAdminRunEventsPage {
  if (!current) return replay;
  const events = new Map(current.events.map((event) => [event.event_id, event]));
  for (const event of replay.events) events.set(event.event_id, event);
  return {
    ...replay,
    events: [...events.values()].sort((left, right) => left.sequence - right.sequence),
  };
}

export function parseAdminReplayPage(body: string): QaAdminRunEventsPage | null {
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  if (!data) return null;
  return qaAdminRunEventsPageSchema.parse(JSON.parse(data));
}
