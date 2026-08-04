/**
 * 候选提案 API Route
 *
 * GET  /api/semantic/governance/candidates — 列出候选提案
 * POST /api/semantic/governance/candidates — 创建新候选提案
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSemanticGovernanceService,
  SemanticGovernanceError,
} from "@/lib/semantic-governance-service";

// ─── 查询参数验证（GET）────────────────────────────────────────────────────────

const querySchema = z.object({
  appId: z.string().default("00000000-0000-0000-0000-000000000001"),
  tenantId: z.string().default("00000000-0000-0000-0000-000000000001"),
  environment: z.string().default("development"),
  semanticDomain: z.string().default("all"),
  group: z
    .union([
      z.literal("my-decision"),
      z.literal("waiting-others"),
      z.literal("expiring"),
      z.literal("completed"),
    ])
    .default("my-decision"),
});

// ─── 请求体验证（POST）─────────────────────────────────────────────────────────

const bodySchema = z.object({
  appId: z.string().default("00000000-0000-0000-0000-000000000001"),
  tenantId: z.string().default("00000000-0000-0000-0000-000000000001"),
  environment: z.string().default("development"),
  semanticDomain: z.string().default("all"),
  title: z.string().min(1, "标题不能为空").max(200, "标题不能超过 200 字"),
  description: z.string().min(1, "描述不能为空"),
  domain: z.string().min(1, "域不能为空"),
  changeClass: z.union([
    z.literal("metric"),
    z.literal("formula"),
    z.literal("relationship"),
    z.literal("binding"),
    z.literal("governance"),
    z.literal("other"),
  ]),
  riskLevel: z.union([
    z.literal("low"),
    z.literal("medium"),
    z.literal("high"),
    z.literal("critical"),
  ]),
  diff: z.string().min(1, "Diff 内容不能为空"),
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
      group: searchParams.get("group") ?? undefined,
    });

    const service = getSemanticGovernanceService();
    const items = await service.getInboxItems(
      {
        appId: query.appId,
        tenantId: query.tenantId,
        environment: query.environment,
        semanticDomain: query.semanticDomain,
      },
      query.group,
    );

    return NextResponse.json({ data: items });
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
    console.error("[candidates:GET] Unexpected error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } },
      { status: 500 },
    );
  }
}

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
    const result = await service.createCandidate(scope, {
      title: parsed.title,
      description: parsed.description,
      domain: parsed.domain,
      changeClass: parsed.changeClass,
      riskLevel: parsed.riskLevel,
      diff: parsed.diff,
    });

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
    console.error("[candidates:POST] Unexpected error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } },
      { status: 500 },
    );
  }
}
