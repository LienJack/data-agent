import { type ModelVendorId, modelProviderSelectionInputSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { fetchProviderModelCatalog, ModelDiscoveryError } from "@/lib/model-discovery";
import {
  findEnvironmentProviderView,
  resolveEnvironmentProviderCredential,
} from "@/lib/model-provider-admin";
import {
  ModelProviderCredentialError,
  resolveManualProviderCredential,
} from "@/lib/model-provider-credential";
import { authorizePricingAdminRequest, pricingResultResponse } from "@/lib/pricing-admin";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly connectionId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authorized = await authorizePricingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const { connectionId } = await context.params;
  const environmentConnection = findEnvironmentProviderView(connectionId);
  let vendorId: ModelVendorId;
  let baseUrl: string;
  let credential: string | undefined;

  if (environmentConnection) {
    vendorId = environmentConnection.vendor_id;
    baseUrl = environmentConnection.base_url;
    credential = resolveEnvironmentProviderCredential(connectionId);
  } else {
    const connections = await authorized.value.repository.listProviderConnections(
      authorized.value.context,
    );
    if (!connections.ok) return pricingResultResponse(connections);
    const connection = connections.value.find(
      (candidate) => candidate.provider_connection_id === connectionId,
    );
    if (connection?.status !== "ACTIVE") {
      return NextResponse.json(
        {
          error: {
            code: "MODEL_PROVIDER_NOT_FOUND",
            message: "供应商连接不存在或已归档。",
            retryable: false,
          },
        },
        { status: 404 },
      );
    }
    vendorId = connection.vendor_id;
    baseUrl = connection.base_url;
    try {
      credential = resolveManualProviderCredential(connection);
    } catch (error) {
      if (error instanceof ModelProviderCredentialError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
              retryable: false,
              credential_locator: error.locator,
            },
          },
          { status: error.status },
        );
      }
      throw error;
    }
  }

  if (!credential) {
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

  try {
    const models = await fetchProviderModelCatalog({ vendorId, baseUrl, apiKey: credential });
    return NextResponse.json({
      data: models.map((model) => ({
        id: model.id,
        display_name: model.displayName,
        ...(model.description ? { description: model.description } : {}),
      })),
    });
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
          code: "MODEL_DISCOVERY_FAILED",
          message: "获取供应商模型目录失败。",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const authorized = await authorizePricingAdminRequest(request);
  if (!authorized.ok) return authorized.response;
  const { connectionId } = await context.params;
  if (findEnvironmentProviderView(connectionId)) {
    return NextResponse.json(
      {
        error: {
          code: "SYSTEM_MODEL_IMMUTABLE",
          message: "环境供应商的模型启动状态由 .env 与部署配置托管。",
          retryable: false,
        },
      },
      { status: 409 },
    );
  }
  const parsed = modelProviderSelectionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success || parsed.data.provider_connection_id !== connectionId) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_PROVIDER_SELECTION_INVALID",
          message: "供应商模型选择不符合严格契约。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  return pricingResultResponse(
    await authorized.value.repository.applyProviderSelection(authorized.value.context, parsed.data),
  );
}
