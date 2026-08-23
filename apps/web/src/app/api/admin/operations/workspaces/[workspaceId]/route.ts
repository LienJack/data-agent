import { adminWorkspaceActionInputSchema } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { getIdentityAdminService } from "@/lib/identity-admin";
import { authorizeOperationsAdminRequest, operationsResultResponse } from "@/lib/operations-admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeOperationsAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const body = await request.json().catch(() => null);
  const parsed = adminWorkspaceActionInputSchema.safeParse(
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? { ...body, workspace_id: workspaceId }
      : body,
  );
  if (!parsed.success) {
    return operationsResultResponse({
      ok: false,
      error: {
        code: "ADMIN_WORKSPACE_ACTION_INVALID",
        message: "工作空间操作不符合严格契约。",
        retryable: false,
      },
    });
  }
  return operationsResultResponse(
    await getIdentityAdminService(request.headers).actOnWorkspace(
      authorized.value.principal.principal_id,
      parsed.data,
    ),
  );
}
