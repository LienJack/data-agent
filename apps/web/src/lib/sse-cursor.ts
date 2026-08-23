/** Select a safe replay cursor. A valid Last-Event-ID always wins over the query fallback. */
export function selectSseCursor(lastEventId: string | null, queryCursor: string | null): number {
  for (const candidate of [lastEventId, queryCursor]) {
    if (!candidate?.trim()) continue;
    const parsed = Number(candidate);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}
