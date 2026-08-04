/**
 * 语义域列表 API Route
 *
 * GET /api/semantic/governance/domains
 * 返回当前 scope 下的语义域列表。
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      appId: searchParams.get("appId") ?? undefined,
      tenantId: searchParams.get("tenantId") ?? undefined,
      environment: searchParams.get("environment") ?? undefined,
      semanticDomain: searchParams.get("semanticDomain") ?? undefined,
    });

    const service = getSemanticGovernanceService();
    const domains = await service.listDomains(query);

    return NextResponse.json({ data: domains });
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
    console.error("[domains] Unexpected error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } },
      { status: 500 },
    );
  }
}
