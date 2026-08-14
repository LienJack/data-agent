/**
 * 语义发布 API Route
 *
 * POST /api/semantic/governance/publish
 * 准备发布或执行发布。
 *   { action: "prepare", packetId: "..." } → 创建发布尝试
 *   { action: "commit",  packetId: "..." } → 执行发布
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  parseSemanticPublishRequest,
  resolveSemanticRouteAuthority,
  semanticRouteErrorResponse,
} from "@/lib/semantic-governance-route";

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseSemanticPublishRequest(body);

    const { runtime, authority } = await resolveSemanticRouteAuthority(
      request,
      "WRITE",
      parsed.input.semantic_domain,
    );

    if (parsed.action === "prepare") {
      const result = await runtime.service.preparePublish(authority, parsed.input);
      return NextResponse.json(
        { data: result, meta: { authority: authority.authority } },
        { status: 201 },
      );
    } else {
      const result = await runtime.service.commitPublish(authority, parsed.input);
      return NextResponse.json(
        { data: result, meta: { authority: authority.authority } },
        { status: 201 },
      );
    }
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_BODY");
  }
}
