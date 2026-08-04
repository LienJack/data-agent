/**
 * 语义回滚 API Route
 *
 * POST /api/semantic/governance/rollback
 * 执行回滚操作。
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSemanticGovernanceService,
  SemanticGovernanceError,
} from "@/lib/semantic-governance-service";

// ─── 请求体验证 ────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  appId: z.string().default("00000000-0000-0000-0000-000000000001"),
  tenantId: z.string().default("00000000-0000-0000-0000-000000000001"),
  environment: z.string().default("development"),
  semanticDomain: z.string().default("all"),
  packetId: z.string().min(1, "审核包 ID 不能为空"),
});

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = bodySchema.parse(body);

    const scope = {
      appId: parsed.appId,
      tenantId: parsed.tenantId,
      environment: parsed.environment,
      semanticDomain: parsed.semanticDomain,
    };

    const service = getSemanticGovernanceService();
    const result = await service.executeRollback(scope, parsed.packetId);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof SemanticGovernanceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "INVALID_BODY", message: "请求体无效", details: error.issues } },
        { status: 400 },
      );
    }
    console.error("[rollback] Unexpected error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } },
      { status: 500 },
    );
  }
}
