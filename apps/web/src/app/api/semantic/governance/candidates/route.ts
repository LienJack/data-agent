/**
 * 候选提案 API Route
 *
 * GET  /api/semantic/governance/candidates — 列出候选提案
 * POST /api/semantic/governance/candidates — 创建新候选提案
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  parseSemanticCandidateRequest,
  resolveSemanticRouteAuthority,
  semanticGovernanceResultResponse,
  semanticRouteErrorResponse,
} from "@/lib/semantic-governance-route";

// ─── 查询参数验证（GET）────────────────────────────────────────────────────────

const querySchema = z.strictObject({
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

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { runtime, authority } = await resolveSemanticRouteAuthority(
      request,
      "READ",
      query.semanticDomain,
    );
    const items = await runtime.service.getInboxItems(authority, query.group);

    return semanticGovernanceResultResponse(items);
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_PARAMS");
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseSemanticCandidateRequest(body);
    const { runtime, authority } = await resolveSemanticRouteAuthority(
      request,
      "WRITE",
      parsed.semantic_domain,
    );
    const result = await runtime.service.createCandidate(authority, parsed);

    return semanticGovernanceResultResponse(result, result.ok && result.value.created ? 201 : 200);
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_BODY");
  }
}
