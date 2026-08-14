import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCreditAdminRequest, creditResultResponse } from "@/lib/credit-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeCreditAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const parsed = z.uuid().nullable().safeParse(request.nextUrl.searchParams.get("principal_id"));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "CREDIT_LEDGER_QUERY_INVALID",
          message: "积分流水查询参数无效。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  return creditResultResponse(
    await authorized.value.repository.listLedger(authorized.value.context, {
      target_principal_id: parsed.data,
    }),
  );
}
