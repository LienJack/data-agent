/**
 * 审核包详情 API Route
 *
 * GET /api/semantic/governance/packets/{id}
 * 返回指定审核包的详细信息。
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSemanticGovernanceService,
  SemanticGovernanceError,
} from "@/lib/semantic-governance-service";

// ─── 查询参数验证 ──────────────────────────────────────────────────────────────

const querySchema = z.object({
  appId: z.string().default("00000000-0000-0000-0000-000000000001"),
  tenantId: z.string().default("00000000-0000-0000-0000-000000000001"),
  environment: z.string().default("development"),
  semanticDomain: z.string().default("all"),
});

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: { code: "MISSING_ID", message: "缺少审核包 ID" } },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      appId: searchParams.get("appId") ?? undefined,
      tenantId: searchParams.get("tenantId") ?? undefined,
      environment: searchParams.get("environment") ?? undefined,
      semanticDomain: searchParams.get("semanticDomain") ?? undefined,
    });

    const service = getSemanticGovernanceService();
    const packet = await service.getPacketDetail(query, id);

    return NextResponse.json({ data: packet });
  } catch (error) {
    if (error instanceof SemanticGovernanceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMS", message: "请求参数无效", details: error.issues } },
        { status: 400 },
      );
    }
    console.error("[packets] Unexpected error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } },
      { status: 500 },
    );
  }
}
