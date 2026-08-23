import { workspaceConversationDirectoryQuerySchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { getWorkspaceDataRepository } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const parameters = request.nextUrl.searchParams;
  const rawQuery = parameters.get("q")?.trim() || null;
  const rawLimit = Number(parameters.get("limit") ?? "50");
  const parsed = workspaceConversationDirectoryQuerySchema.safeParse({
    schema_version: "workspace-conversation-directory-query@1.0.0",
    view: parameters.get("view") ?? "active",
    folder_id: parameters.get("folder") || null,
    query: rawQuery,
    cursor: parameters.get("cursor") || null,
    limit: rawLimit,
  });
  if (!parsed.success) {
    return workspaceErrorResponse({
      code: "QA_DIRECTORY_QUERY_INVALID",
      message: "目录查询参数无效。",
      retryable: false,
    });
  }
  const result = await getWorkspaceDataRepository().listConversationDirectory(
    authorized.value.capability,
    parsed.data,
  );
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return workspaceErrorResponse({
      code: "CONVERSATION_INPUT_INVALID",
      message: "请求体必须是 JSON。",
      retryable: false,
    });
  }
  const result = await getWorkspaceDataRepository().createConversation(
    authorized.value.capability,
    input,
  );
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 201 })
    : workspaceErrorResponse(result.error);
}
