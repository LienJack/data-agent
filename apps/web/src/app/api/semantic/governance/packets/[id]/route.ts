/**
 * 审核包详情 API Route
 *
 * GET /api/semantic/governance/packets/{id}
 * 返回指定审核包的详细信息。
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveSemanticRouteAuthority,
  semanticGovernanceResultResponse,
  semanticRouteErrorResponse,
} from "@/lib/semantic-governance-route";

// ─── 查询参数验证 ──────────────────────────────────────────────────────────────

const querySchema = z.strictObject({
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

    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { runtime, authority } = await resolveSemanticRouteAuthority(
      request,
      "READ",
      query.semanticDomain,
    );
    const packet = await runtime.service.getPacketDetail(authority, id);

    return semanticGovernanceResultResponse(packet);
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_PARAMS");
  }
}
