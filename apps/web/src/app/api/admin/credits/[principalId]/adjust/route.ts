import { creditAdjustmentInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeCreditAdminRequest, creditResultResponse } from "@/lib/credit-admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ principalId: string }> },
) {
  const authorized = await authorizeCreditAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const raw = await request.json().catch(() => null);
  const { principalId } = await params;
  const parsed = creditAdjustmentInputSchema.safeParse(
    typeof raw === "object" && raw !== null ? { ...raw, target_principal_id: principalId } : raw,
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "CREDIT_ADJUSTMENT_INVALID",
          message: "积分调账命令无效。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  return creditResultResponse(
    await authorized.value.repository.adjust(authorized.value.context, parsed.data),
  );
}
