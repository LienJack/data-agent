import type { NextRequest } from "next/server";
import { authorizePricingAdminRequest, pricingResultResponse } from "@/lib/pricing-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizePricingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  return pricingResultResponse(
    await authorized.value.repository.listModelAuthentications(authorized.value.context),
  );
}
