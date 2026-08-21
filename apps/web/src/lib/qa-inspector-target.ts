import { type QaInspectorTarget, qaInspectorTargetSchema } from "@data-agent/contracts";

const INSPECTOR_QUERY_KEY = "inspector";

export function qaConversationHref(baseHref: string, conversationId: string): string {
  const url = new URL(baseHref, "http://data-agent.local");
  url.searchParams.set("conversation", conversationId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function parseQAInspectorTarget(
  parameters: Pick<URLSearchParams, "get">,
): QaInspectorTarget | null {
  const encoded = parameters.get(INSPECTOR_QUERY_KEY);
  if (!encoded || encoded.length > 8_192) return null;
  try {
    return qaInspectorTargetSchema.parse(JSON.parse(encoded));
  } catch {
    return null;
  }
}

export function applyQAInspectorTargetToUrl(url: URL, target: QaInspectorTarget | null): URL {
  if (target) url.searchParams.set(INSPECTOR_QUERY_KEY, JSON.stringify(target));
  else url.searchParams.delete(INSPECTOR_QUERY_KEY);
  return url;
}

export function replaceQAInspectorTargetInBrowser(
  target: QaInspectorTarget | null,
  conversationId?: string | null,
): void {
  if (typeof window === "undefined") return;
  const url = applyQAInspectorTargetToUrl(new URL(window.location.href), target);
  if (conversationId) url.searchParams.set("conversation", conversationId);
  window.history.replaceState(null, "", url);
}
