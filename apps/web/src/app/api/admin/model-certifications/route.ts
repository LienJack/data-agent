import type { NextRequest } from "next/server";
import {
  authorizeModelControlAdminRequest,
  modelControlResultResponse,
} from "@/lib/model-control-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizeModelControlAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  return modelControlResultResponse(
    await authorized.value.repository.listModelAuthentications(authorized.value.context),
  );
}
