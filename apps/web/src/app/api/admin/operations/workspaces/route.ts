import { createAdminWorkspaceInputSchema } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import { getIdentityAdminService } from "@/lib/identity-admin";
import { authorizeOperationsAdminRequest, operationsResultResponse } from "@/lib/operations-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeOperationsAdminRequest(request);
  return authorized.ok
    ? operationsResultResponse(
        await authorized.value.repository.listWorkspaces(authorized.value.context),
      )
    : authorized.response;
}

export async function POST(request: NextRequest) {
  const authorized = await authorizeOperationsAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const parsed = createAdminWorkspaceInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return operationsResultResponse({
      ok: false,
      error: {
        code: "ADMIN_WORKSPACE_CREATE_INVALID",
        message: "新建工作空间命令不符合严格契约。",
        retryable: false,
      },
    });
  }
  return operationsResultResponse(
    await getIdentityAdminService(request.headers).createWorkspace(
      authorized.value.principal.principal_id,
      parsed.data,
    ),
    201,
  );
}
