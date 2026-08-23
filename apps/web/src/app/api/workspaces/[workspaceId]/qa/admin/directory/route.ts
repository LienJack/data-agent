import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  authorizeQaAdminAuditRequest,
  issueQaAdminCursor,
  qaAdminResultResponse,
  verifyQaAdminCursor,
} from "@/lib/qa-admin-audit";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const searchSchema = z.strictObject({
  ownerPrincipalId: z.uuid().nullable(),
  folderId: z.uuid().nullable(),
  lifecycle: z.enum(["ACTIVE", "ARCHIVED", "TRASH"]).nullable(),
  liveState: z
    .enum(["IDLE", "RUNNING", "WAITING_APPROVAL", "WAITING_ANSWER", "FAILED", "COMPLETED"])
    .nullable(),
  query: z.string().trim().min(1).max(120).nullable(),
  cursor: z.string().min(1).max(2_048).nullable(),
  limit: z.coerce.number().int().min(1).max(50),
});

function nullable(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeQaAdminAuditRequest(request, workspaceId);
  if (!authorized.ok) return authorized.response;
  const parsed = searchSchema.safeParse({
    ownerPrincipalId: nullable(request.nextUrl.searchParams.get("ownerPrincipalId")),
    folderId: nullable(request.nextUrl.searchParams.get("folderId")),
    lifecycle: nullable(request.nextUrl.searchParams.get("lifecycle")),
    liveState: nullable(request.nextUrl.searchParams.get("liveState")),
    query: nullable(request.nextUrl.searchParams.get("query")),
    cursor: nullable(request.nextUrl.searchParams.get("cursor")),
    limit: request.nextUrl.searchParams.get("limit") ?? 25,
  });
  if (!parsed.success) {
    return qaAdminResultResponse({
      ok: false,
      error: {
        code: "QA_ADMIN_QUERY_INVALID",
        message: "管理员目录筛选条件不符合契约。",
        retryable: false,
      },
    });
  }
  const binding = JSON.stringify({
    actor: authorized.value.session.principal_id,
    workspaceId,
    ownerPrincipalId: parsed.data.ownerPrincipalId,
    folderId: parsed.data.folderId,
    lifecycle: parsed.data.lifecycle,
    liveState: parsed.data.liveState,
    query: parsed.data.query,
    limit: parsed.data.limit,
  });
  const cursor = parsed.data.cursor ? verifyQaAdminCursor(parsed.data.cursor, binding) : null;
  if (parsed.data.cursor && cursor === null) {
    return qaAdminResultResponse({
      ok: false,
      error: {
        code: "QA_ADMIN_QUERY_INVALID",
        message: "管理员目录 cursor 无效或已过期。",
        retryable: false,
      },
    });
  }
  const result = await authorized.value.repository.readDirectory(authorized.value.capability, {
    schema_version: "qa-admin-directory-query@1.0.0",
    workspace_id: workspaceId,
    owner_principal_id: parsed.data.ownerPrincipalId,
    folder_id: parsed.data.folderId,
    lifecycle: parsed.data.lifecycle,
    live_state: parsed.data.liveState,
    query: parsed.data.query,
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
