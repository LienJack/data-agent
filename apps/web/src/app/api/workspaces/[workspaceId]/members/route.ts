import { workspaceMemberActionInputSchema } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { getIdentityAdminService } from "@/lib/identity-admin";
import {
  authorizeWorkspaceMembersRequest,
  operationsResultResponse,
} from "@/lib/operations-admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceMembersRequest(request, workspaceId);
  return authorized.ok
    ? operationsResultResponse(
        await authorized.value.repository.listWorkspaceMembers(authorized.value.context),
      )
    : authorized.response;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceMembersRequest(request, workspaceId);
  if (!authorized.ok) return authorized.response;
  const parsed = workspaceMemberActionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return operationsResultResponse({
      ok: false,
      error: {
        code: "WORKSPACE_MEMBER_ACTION_INVALID",
        message: "成员操作不符合严格契约。",
        retryable: false,
      },
    });
  }
  return operationsResultResponse(
    await getIdentityAdminService(request.headers).actOnMember(
      authorized.value.principal.principal_id,
      workspaceId,
      parsed.data,
    ),
  );
}
