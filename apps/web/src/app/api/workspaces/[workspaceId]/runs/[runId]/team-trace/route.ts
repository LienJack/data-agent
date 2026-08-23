import { type NextRequest, NextResponse } from "next/server";
import { getAgentTeamTraceProjector } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ workspaceId: string; runId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getAgentTeamTraceProjector().load(authorized.value.capability, {
    scope: authorized.value.capability.scope,
    run_id: runId,
  });
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
