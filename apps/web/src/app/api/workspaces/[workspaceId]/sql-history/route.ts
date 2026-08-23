import { type NextRequest, NextResponse } from "next/server";
import { getResolutionTraceProjector } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const runId = request.nextUrl.searchParams.get("run_id") || undefined;
  const conversationId = request.nextUrl.searchParams.get("conversation_id") || undefined;
  const occurredAfter = request.nextUrl.searchParams.get("occurred_after") || undefined;
  const occurredBefore = request.nextUrl.searchParams.get("occurred_before") || undefined;
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  const result = await getResolutionTraceProjector().listSqlHistory(authorized.value.capability, {
    scope: authorized.value.capability.scope,
    ...(runId ? { run_id: runId } : {}),
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(occurredAfter ? { occurred_after: occurredAfter } : {}),
    ...(occurredBefore ? { occurred_before: occurredBefore } : {}),
    limit: requestedLimit,
  });
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
