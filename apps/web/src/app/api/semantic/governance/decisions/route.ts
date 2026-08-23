/**
 * 审核决策 API Route
 *
 * POST /api/semantic/governance/decisions
 * 提交审核决策（批准/拒绝）。
 */

import { semanticDecisionInputSchema } from "@data-agent/contracts";
import type { NextRequest } from "next/server";
import {
  resolveSemanticRouteAuthority,
  semanticGovernanceResultResponse,
  semanticRouteErrorResponse,
} from "@/lib/semantic-governance-route";

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = semanticDecisionInputSchema.parse(body);
    const { runtime, authority } = await resolveSemanticRouteAuthority(
      request,
      "WRITE",
      parsed.semantic_domain,
    );
    const result = await runtime.service.submitDecision(authority, parsed);

    return semanticGovernanceResultResponse(result, 201);
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_BODY");
  }
}
