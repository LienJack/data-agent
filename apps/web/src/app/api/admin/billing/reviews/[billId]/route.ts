import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  authorizeModelBillingAdminRequest,
  modelBillingResultResponse,
} from "@/lib/model-billing-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ billId: string }> }) {
  const authorized = await authorizeModelBillingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const billId = z.uuid().safeParse((await context.params).billId);
  if (!billId.success) {
    return modelBillingResultResponse({
      ok: false,
      error: {
        code: "MODEL_BILLING_REVIEW_INVALID",
        message: "账单标识无效。",
        retryable: false,
      },
    });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return modelBillingResultResponse({
      ok: false,
      error: {
        code: "MODEL_BILLING_REVIEW_INVALID",
        message: "复核请求不是有效 JSON。",
        retryable: false,
      },
    });
  }
  return modelBillingResultResponse(
    await authorized.value.repository.review(authorized.value.context, {
      ...(typeof body === "object" && body !== null ? body : {}),
      bill_id: billId.data,
    }),
  );
}
