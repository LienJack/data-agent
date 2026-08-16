import { upsertModelProviderConnectionInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { composeModelProviderViews } from "@/lib/model-provider-admin";
import { authorizePricingAdminRequest, pricingResultResponse } from "@/lib/pricing-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorized = await authorizePricingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const [connections, models] = await Promise.all([
    authorized.value.repository.listProviderConnections(authorized.value.context),
    authorized.value.repository.listModels(authorized.value.context),
  ]);
  if (!connections.ok) return pricingResultResponse(connections);
  if (!models.ok) return pricingResultResponse(models);
  return NextResponse.json({ data: composeModelProviderViews(connections.value, models.value) });
}

export async function POST(request: NextRequest) {
  const authorized = await authorizePricingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const parsed = upsertModelProviderConnectionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_PROVIDER_COMMAND_INVALID",
          message: "供应商连接不符合严格契约，且请求不能包含明文 API Key。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  return pricingResultResponse(
    await authorized.value.repository.applyProviderConnectionCommand(
      authorized.value.context,
      parsed.data,
    ),
    201,
  );
}
