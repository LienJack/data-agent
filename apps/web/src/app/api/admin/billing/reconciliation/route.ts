import type { NextRequest } from "next/server";
import {
  authorizeModelBillingAdminRequest,
  modelBillingResultResponse,
} from "@/lib/model-billing-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeModelBillingAdminRequest(request);
  return authorized.ok
    ? modelBillingResultResponse(
        await authorized.value.repository.reconcile(authorized.value.context),
      )
    : authorized.response;
}
