import type { NextRequest } from "next/server";
import {
  authorizeModelBillingAdminRequest,
  modelBillingResultResponse,
} from "@/lib/model-billing-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeModelBillingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const state = request.nextUrl.searchParams.get("state");
  return modelBillingResultResponse(
    await authorized.value.repository.listBills(authorized.value.context, { state }),
  );
}
