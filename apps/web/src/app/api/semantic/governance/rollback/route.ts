/**
 * 语义回滚 API Route
 *
 * POST /api/semantic/governance/rollback
 * 执行回滚操作。
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  parseSemanticRollbackRequest,
  resolveSemanticRouteAuthority,
  semanticRouteErrorResponse,
} from "@/lib/semantic-governance-route";

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseSemanticRollbackRequest(body);
    const { runtime, authority } = await resolveSemanticRouteAuthority(
      request,
      "WRITE",
      parsed.semantic_domain,
    );
    const result = await runtime.service.executeRollback(authority, parsed);

    return NextResponse.json(
      { data: result, meta: { authority: authority.authority } },
      { status: 201 },
    );
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_BODY");
  }
}
