import type { NextRequest } from "next/server";
import { authorizeCreditRequest, creditResultResponse } from "@/lib/credit-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeCreditRequest(request);
  return authorized.ok
    ? creditResultResponse(
        await authorized.value.repository.getOwnAccount(authorized.value.context),
      )
    : authorized.response;
}
