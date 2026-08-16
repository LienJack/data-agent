import { qaConversationResourceSwitchInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { getWorkspaceDataRepository } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = qaConversationResourceSwitchInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return workspaceErrorResponse({
      code: "CONVERSATION_INPUT_INVALID",
      message: "对话资源切换请求不符合契约。",
      retryable: false,
    });
  }
  const result = await getWorkspaceDataRepository().switchConversationResources(
    authorized.value.capability,
    conversationId,
    input.data,
  );
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
