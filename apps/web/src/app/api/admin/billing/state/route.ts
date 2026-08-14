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
        await authorized.value.repository.getRuntimeState(authorized.value.context),
      )
    : authorized.response;
}

export async function POST(request: NextRequest) {
  const authorized = await authorizeModelBillingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return modelBillingResultResponse({
      ok: false,
      error: {
        code: "BILLING_MODE_DECISION_INVALID",
        message: "计费模式审批请求不是有效 JSON。",
        retryable: false,
      },
    });
  }
  return modelBillingResultResponse(
    await authorized.value.repository.decideMode(authorized.value.context, body),
  );
}
