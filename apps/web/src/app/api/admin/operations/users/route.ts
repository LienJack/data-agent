import { createAdminUserInputSchema } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { getIdentityAdminService } from "@/lib/identity-admin";
import { authorizeOperationsAdminRequest, operationsResultResponse } from "@/lib/operations-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeOperationsAdminRequest(request);
  return authorized.ok
    ? operationsResultResponse(
        await authorized.value.repository.listUsers(authorized.value.context),
      )
    : authorized.response;
}

export async function POST(request: NextRequest) {
  const authorized = await authorizeOperationsAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const parsed = createAdminUserInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return operationsResultResponse({
      ok: false,
      error: {
        code: "ADMIN_USER_CREATE_INVALID",
        message: "新建用户命令不符合严格契约。",
        retryable: false,
      },
    });
  }
  return operationsResultResponse(
    await getIdentityAdminService(request.headers).createUser(
      authorized.value.principal.principal_id,
      parsed.data,
    ),
    201,
  );
}
