import { adminUserActionInputSchema } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { getIdentityAdminService } from "@/lib/identity-admin";
import { authorizeOperationsAdminRequest, operationsResultResponse } from "@/lib/operations-admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ principalId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { principalId } = await context.params;
  const authorized = await authorizeOperationsAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const body = await request.json().catch(() => null);
  const parsed = adminUserActionInputSchema.safeParse(
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? { ...body, principal_id: principalId }
      : body,
  );
  if (!parsed.success) {
    return operationsResultResponse({
      ok: false,
      error: {
        code: "ADMIN_USER_ACTION_INVALID",
        message: "用户操作不符合严格契约。",
        retryable: false,
      },
    });
  }
  return operationsResultResponse(
    await getIdentityAdminService(request.headers).actOnUser(
      authorized.value.principal.principal_id,
      parsed.data,
    ),
  );
}
