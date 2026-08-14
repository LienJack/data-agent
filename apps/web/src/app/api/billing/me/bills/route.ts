import type { NextRequest } from "next/server";
import {
  authorizeModelBillingRequest,
  modelBillingResultResponse,
} from "@/lib/model-billing-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeModelBillingRequest(request);
  return authorized.ok
    ? modelBillingResultResponse(
        await authorized.value.repository.listOwnBills(authorized.value.context),
      )
    : authorized.response;
}
