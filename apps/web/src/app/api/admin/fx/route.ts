import type { NextRequest } from "next/server";
import { authorizePricingAdminRequest, pricingResultResponse } from "@/lib/pricing-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizePricingAdminRequest(request);
  return authorized.ok
    ? pricingResultResponse(
        await authorized.value.repository.listFxCandidates(authorized.value.context),
      )
    : authorized.response;
}
