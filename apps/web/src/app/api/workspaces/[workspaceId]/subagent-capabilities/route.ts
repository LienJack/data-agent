import { projectSubagentCapabilityCatalogItem } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAgentProfileRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);

  const profiles = await getAgentProfileRegistry().listDiscoverable(authorized.value.capability);
  if (!profiles.ok) return workspaceErrorResponse(profiles.error);

  const items = await Promise.all(profiles.value.map(projectSubagentCapabilityCatalogItem));
  return NextResponse.json({
    data: {
      schema_version: "subagent-capability-catalog-view@1.0.0",
      items,
    },
  });
}
