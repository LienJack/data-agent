import type { NextRequest } from "next/server";
import { handleStartSchemaScan } from "@/lib/schema-discovery-route";
import { workspaceErrorResponse } from "@/lib/workspace-request";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; datasourceId: string }> },
) {
  const { workspaceId, datasourceId } = await context.params;
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
  const resolved = await getWorkspaceSemanticRuntime(scopedRequest, {
    feature: "SCHEMA_DISCOVERY",
    access: "WRITE",
    workspaceId,
  });
  return resolved.ok
    ? handleStartSchemaScan(scopedRequest, Promise.resolve({ id: datasourceId }), resolved.runtime)
    : resolved.response;
}
