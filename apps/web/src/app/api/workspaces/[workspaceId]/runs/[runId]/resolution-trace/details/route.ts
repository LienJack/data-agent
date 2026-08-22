import { type NextRequest, NextResponse } from "next/server";
import { getResolutionTraceProjector } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ workspaceId: string; runId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const nodeId = request.nextUrl.searchParams.get("node_id");
  const result = await getResolutionTraceProjector().loadDetail(authorized.value.capability, {
    scope: authorized.value.capability.scope,
    run_id: runId,
    node_id: nodeId,
  });
  if (!result.ok) return workspaceErrorResponse(result.error);
  if (!result.value) {
    return workspaceErrorResponse({
      code: "RESOLUTION_TRACE_DETAIL_NOT_FOUND_OR_DENIED",
      message: "轨迹记录不存在或无权访问。",
      retryable: false,
    });
  }
  return NextResponse.json({ data: result.value });
}
