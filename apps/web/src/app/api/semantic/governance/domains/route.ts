/**
 * 语义域列表 API Route
 *
 * GET /api/semantic/governance/domains
 * 返回当前 scope 下的语义域列表。
 */

import type { NextRequest } from "next/server";
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

export async function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { runtime, authority } = await resolveSemanticRouteAuthority(
      request,
      "READ",
      query.semanticDomain,
    );
    const domains = await runtime.service.listDomains(authority);

    return semanticGovernanceResultResponse(domains);
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_PARAMS");
  }
}
