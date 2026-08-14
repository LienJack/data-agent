import { pricingCandidateDecisionInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { authorizePricingAdminRequest, pricingResultResponse } from "@/lib/pricing-admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const authorized = await authorizePricingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const parsed = pricingCandidateDecisionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  const { candidateId } = await params;
  if (!parsed.success || parsed.data.candidate_id !== candidateId) {
    return NextResponse.json(
      {
        error: {
          code: "PRICING_DECISION_INVALID",
          message: "价格审批命令无效。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  return pricingResultResponse(
    await authorized.value.repository.decideCandidate(
      authorized.value.context,
      "MODEL_PRICE",
      parsed.data,
    ),
  );
}
