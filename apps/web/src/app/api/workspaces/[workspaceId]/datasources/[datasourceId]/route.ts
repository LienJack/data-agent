import { type NextRequest, NextResponse } from "next/server";
import { getWorkspaceDataRepository } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string; datasourceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, datasourceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getWorkspaceDataRepository().getDatasource(
    authorized.value.capability,
    datasourceId,
  );
  if (!result.ok) return workspaceErrorResponse(result.error);
  if (!result.value) {
    return workspaceErrorResponse({
      code: "DATASOURCE_NOT_FOUND_OR_DENIED",
      message: "数据源不存在或不属于当前工作空间。",
      retryable: false,
    });
  }
  return NextResponse.json({ data: result.value });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { workspaceId, datasourceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getWorkspaceDataRepository().disableDatasource(
    authorized.value.capability,
    datasourceId,
  );
  return result.ok
    ? NextResponse.json({ data: { success: true } })
    : workspaceErrorResponse(result.error);
}
