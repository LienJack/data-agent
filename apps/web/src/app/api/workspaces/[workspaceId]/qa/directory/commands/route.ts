import { verifyWorkspaceConversationDirectoryCommand } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { getWorkspaceDataRepository } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  try {
    await verifyWorkspaceConversationDirectoryCommand(raw);
  } catch {
    return workspaceErrorResponse({
      code: "QA_DIRECTORY_COMMAND_INVALID",
      message: "目录操作不符合契约。",
      retryable: false,
    });
  }
  const result = await getWorkspaceDataRepository().applyConversationDirectoryCommand(
    authorized.value.capability,
    raw,
  );
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
