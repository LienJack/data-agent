import { startModelCertificationInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { fetchProviderModelCatalog, ModelDiscoveryError } from "@/lib/model-discovery";
import {
  findEnvironmentProviderView,
  resolveEnvironmentProviderCredential,
} from "@/lib/model-provider-admin";
import { authorizePricingAdminRequest, pricingResultResponse } from "@/lib/pricing-admin";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelProfileId: string }> },
) {
  const { modelProfileId } = await params;
  const input = startModelCertificationInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success || input.data.model_profile_id !== modelProfileId) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_CERTIFICATION_INPUT_INVALID",
          message: "模型认证请求不符合严格契约。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  const authorized = await authorizePricingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const models = await authorized.value.repository.listModels(authorized.value.context);
  if (!models.ok) return pricingResultResponse(models);
  const model = models.value.find(
    (candidate) =>
      candidate.model_profile_id === input.data.model_profile_id &&
      candidate.config_version === input.data.expected_config_version,
  );
  if (
    !model ||
    !(
      (model.provider === "deepseek" && model.model_id === "deepseek-v4-flash") ||
      (model.provider === "kimi" && model.model_id === "kimi-k3")
    )
  ) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_CERTIFICATION_TARGET_NOT_AVAILABLE",
          message: "目标模型不存在、版本已变化或尚不支持认证。",
          retryable: false,
        },
      },
      { status: 409 },
    );
  }
  const connection = findEnvironmentProviderView(model.model_profile_id);
  const credential = resolveEnvironmentProviderCredential(model.model_profile_id);
  if (!connection || !credential) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_CREDENTIAL_NOT_CONFIGURED",
          message: "供应商环境凭据未配置。",
          retryable: false,
        },
      },
      { status: 409 },
    );
  }
  let responseItemCount: number;
  try {
    const discovered = await fetchProviderModelCatalog({
      vendorId: connection.vendor_id,
      baseUrl: connection.base_url,
      apiKey: credential,
    });
    if (discovered.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "MODEL_CERTIFICATION_RESPONSE_EMPTY",
            message: "供应商模型目录未返回数据。",
            retryable: false,
          },
        },
        { status: 409 },
      );
    }
    responseItemCount = discovered.length;
  } catch (error) {
    if (error instanceof ModelDiscoveryError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, retryable: error.status >= 500 } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "MODEL_CERTIFICATION_REQUEST_FAILED",
          message: "供应商 API 请求失败。",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
  const certified = await authorized.value.repository.recordModelAuthentication(
    authorized.value.context,
    {
      schema_version: "model-api-authentication@1.0.0",
      model_profile_id: model.model_profile_id,
      expected_config_version: model.config_version,
      response_item_count: responseItemCount,
      idempotency_key: input.data.idempotency_key,
    },
  );
  return pricingResultResponse(certified);
}
