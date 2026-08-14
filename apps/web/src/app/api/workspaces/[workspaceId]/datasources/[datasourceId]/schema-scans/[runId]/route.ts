import type { NextRequest } from "next/server";
import { handleGetSchemaScan } from "@/lib/schema-discovery-route";
import { workspaceErrorResponse } from "@/lib/workspace-request";
import { getWorkspaceSchemaDiscoveryRuntime } from "@/lib/workspace-semantic-runtime";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; datasourceId: string; runId: string }> },
) {
  const { workspaceId, datasourceId, runId } = await context.params;
  const asserted = request.headers.get("x-workspace-id")?.trim();
  if (asserted && asserted !== workspaceId) {
    return workspaceErrorResponse({
      code: "WORKSPACE_ACCESS_DENIED",
      message: "工作空间不存在或无权访问。",
      retryable: false,
    });
  }
  const headers = new Headers(request.headers);
  headers.set("x-workspace-id", workspaceId);
  const scopedRequest = new Request(request, { headers }) as NextRequest;
  const resolved = await getWorkspaceSchemaDiscoveryRuntime(scopedRequest, "READ");
  return resolved.ok
    ? handleGetSchemaScan(Promise.resolve({ id: datasourceId, runId }), resolved.runtime)
    : resolved.response;
}
