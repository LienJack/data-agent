import type { NextRequest } from "next/server";
import { authorizeQaAdminAuditRequest, qaAdminResultResponse } from "@/lib/qa-admin-audit";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeQaAdminAuditRequest(request, workspaceId);
  if (!authorized.ok) return authorized.response;
  const raw = await request.json().catch(() => null);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return qaAdminResultResponse({
      ok: false,
      error: {
        code: "QA_ADMIN_QUERY_INVALID",
        message: "管理员 Artifact 查询不符合契约。",
        retryable: false,
      },
    });
  }
  return qaAdminResultResponse(
    await authorized.value.repository.authorizeArtifactAccess(authorized.value.capability, {
      ...raw,
      workspace_id: workspaceId,
      conversation_id: conversationId,
    }),
  );
}
