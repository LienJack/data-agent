import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  authorizeQaAdminAuditRequest,
  issueQaAdminCursor,
  qaAdminResultResponse,
  verifyQaAdminCursor,
} from "@/lib/qa-admin-audit";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

const searchSchema = z.strictObject({
  ownerPrincipalId: z.uuid(),
  cursor: z.string().min(1).max(2_048).nullable(),
  limit: z.coerce.number().int().min(1).max(200),
});

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeQaAdminAuditRequest(request, workspaceId);
  if (!authorized.ok) return authorized.response;
  const parsed = searchSchema.safeParse({
    ownerPrincipalId: request.nextUrl.searchParams.get("ownerPrincipalId"),
    cursor: request.nextUrl.searchParams.get("cursor")?.trim() || null,
    limit: request.nextUrl.searchParams.get("limit") ?? 100,
  });
  if (!parsed.success) {
    return qaAdminResultResponse({
      ok: false,
      error: {
        code: "QA_ADMIN_QUERY_INVALID",
        message: "管理员对话查询不符合契约。",
        retryable: false,
      },
    });
  }
  const binding = JSON.stringify({
    actor: authorized.value.session.principal_id,
    workspaceId,
    ownerPrincipalId: parsed.data.ownerPrincipalId,
    conversationId,
    limit: parsed.data.limit,
  });
  const cursor = parsed.data.cursor ? verifyQaAdminCursor(parsed.data.cursor, binding) : null;
  if (parsed.data.cursor && cursor === null) {
    return qaAdminResultResponse({
      ok: false,
      error: {
        code: "QA_ADMIN_QUERY_INVALID",
        message: "管理员消息 cursor 无效或已过期。",
        retryable: false,
      },
    });
  }
  const result = await authorized.value.repository.readConversation(authorized.value.capability, {
    schema_version: "qa-admin-conversation-query@1.0.0",
    operation: "MESSAGES_READ",
    workspace_id: workspaceId,
    owner_principal_id: parsed.data.ownerPrincipalId,
    conversation_id: conversationId,
    cursor,
    limit: parsed.data.limit,
  });
  if (!result.ok || result.value.next_cursor === null) return qaAdminResultResponse(result);
  return qaAdminResultResponse({
    ok: true,
    value: {
      ...result.value,
      next_cursor: issueQaAdminCursor(binding, result.value.next_cursor),
    },
  });
}
