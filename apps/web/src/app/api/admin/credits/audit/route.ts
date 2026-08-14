import type { NextRequest } from "next/server";
import { authorizeCreditAdminRequest, creditResultResponse } from "@/lib/credit-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeCreditAdminRequest(request);
  return authorized.ok
    ? creditResultResponse(await authorized.value.repository.listAudit(authorized.value.context))
    : authorized.response;
}
