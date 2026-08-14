import type { NextRequest } from "next/server";
import {
  authorizeOperationsAdminRequest,
  operationsResultResponse,
} from "@/lib/operations-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeOperationsAdminRequest(request);
  return authorized.ok
    ? operationsResultResponse(
        await authorized.value.repository.readHealth(authorized.value.context),
      )
    : authorized.response;
}
