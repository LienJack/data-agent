import { type NextRequest, NextResponse } from "next/server";
import { mergeSystemModelsWithCatalog, resolveSystemModelsFromProcess } from "@/lib/system-models";
import {
  getModelControlRepository,
  getWorkspaceDeploymentId,
  getWorkspaceSessionFromHeaders,
} from "@/lib/workspace-identity";

export const runtime = "nodejs";

/**
 * GET  /api/models — 获取系统模型与手工配置的安全投影
 * POST /api/models — 创建手工模型配置
 */

export async function GET(request: NextRequest) {
  const session = await getWorkspaceSessionFromHeaders(request.headers);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 });
  const result = await getModelControlRepository().listActiveModels({
    deployment_id: getWorkspaceDeploymentId(),
    principal_id: session.value.principal_id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });
  const catalogModels = result.value.map((entry) => ({
    id: entry.model_profile_id,
    name: entry.display_name,
    vendorId: entry.provider,
    provider: entry.provider,
    modelName: entry.model_id,
    source: "manual" as const,
    isSystemModel: false,
    isSystemDefault: entry.is_system_default,
    connectionStatus:
      entry.credential_ref?.rotation_state === "ACTIVE"
        ? ("configured" as const)
        : ("unchecked" as const),
    apiKeyMasked: entry.credential_ref ? "SecretRef 已配置" : "未配置",
    baseUrl: entry.base_url,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  }));
  return NextResponse.json({
    data: mergeSystemModelsWithCatalog(resolveSystemModelsFromProcess(), catalogModels),
  });
}

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: {
        code: "MODEL_ADMIN_ROUTE_REQUIRED",
        message: "模型变更必须使用超级管理员控制面。",
        retryable: false,
      },
    },
    { status: 410 },
  );
}
