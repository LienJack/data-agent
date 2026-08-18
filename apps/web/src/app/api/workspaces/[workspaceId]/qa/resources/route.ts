import { type NextRequest, NextResponse } from "next/server";
import { buildQaResourceCatalog } from "@/lib/qa-resource-catalog";
import {
  getPricingControlRepository,
  getProviderInvocationStore,
  getWorkspaceDataRepository,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);

  const [models, authentications, datasources] = await Promise.all([
    getProviderInvocationStore().listExecutionProfiles(authorized.value.capability),
    getPricingControlRepository().listModelAuthentications({
      deployment_id: authorized.value.capability.deployment_id,
      principal_id: authorized.value.capability.principal,
    }),
    getWorkspaceDataRepository().listDatasources(authorized.value.capability),
  ]);
  if (!models.ok) return workspaceErrorResponse(models.error);
  if (!authentications.ok) return workspaceErrorResponse(authentications.error);
  if (!datasources.ok) return workspaceErrorResponse(datasources.error);

  return NextResponse.json({
    data: buildQaResourceCatalog({
      models: models.value,
      authentications: authentications.value,
      datasources: datasources.value,
    }),
  });
}
