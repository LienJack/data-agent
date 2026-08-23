import { type NextRequest, NextResponse } from "next/server";
import { getWorkspaceJobQueue, projectCapabilityReadiness } from "@/lib/job-center";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getWorkspaceJobQueue(authorized.value.capability).listReadiness({
    scope: authorized.value.capability.scope,
  });
  return result.ok
    ? NextResponse.json(
        { capabilities: result.value.map(projectCapabilityReadiness) },
        { headers: { "Cache-Control": "no-store" } },
      )
    : workspaceErrorResponse(result.error);
}
