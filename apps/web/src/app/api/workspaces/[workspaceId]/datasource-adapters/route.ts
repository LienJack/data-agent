import { createBuiltinDatasourceAdapterRegistry } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const registry = await createBuiltinDatasourceAdapterRegistry();
  return NextResponse.json({ data: await registry.snapshot() });
}
