import { type NextRequest, NextResponse } from "next/server";
import { buildQaResourceCatalog } from "@/lib/qa-resource-catalog";
import { getProviderInvocationStore, getWorkspaceDataRepository } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);

  const [models, datasources] = await Promise.all([
    getProviderInvocationStore().listExecutionProfiles(authorized.value.capability),
    getWorkspaceDataRepository().listDatasources(authorized.value.capability),
  ]);
  if (!models.ok) return workspaceErrorResponse(models.error);
  if (!datasources.ok) return workspaceErrorResponse(datasources.error);

  return NextResponse.json({
    data: buildQaResourceCatalog({ models: models.value, datasources: datasources.value }),
  });
}
