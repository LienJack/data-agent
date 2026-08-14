import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeCreditAdminRequest, creditResultResponse } from "@/lib/credit-admin";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ principalId: string }> },
) {
  const authorized = await authorizeCreditAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const principalId = z.uuid().safeParse((await params).principalId);
  return principalId.success
    ? creditResultResponse(
        await authorized.value.repository.reconcile(authorized.value.context, principalId.data),
      )
    : creditResultResponse({
        ok: false,
        error: {
          code: "CREDIT_RECONCILIATION_INVALID",
          message: "积分对账目标无效。",
          retryable: false,
        },
      });
}
