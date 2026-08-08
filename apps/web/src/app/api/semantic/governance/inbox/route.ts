/**
 * 语义收件箱 API Route
 *
 * GET /api/semantic/governance/inbox?group=my-decision
 * 返回指定分组的收件箱条目。
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveSemanticRouteAuthority,
  semanticRouteErrorResponse,
} from "@/lib/semantic-governance-route";

// ─── 查询参数验证 ──────────────────────────────────────────────────────────────

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
      "READ",
      query.semanticDomain,
    );
    const items = await runtime.service.getInboxItems(authority, query.group);

    return NextResponse.json({ data: items, meta: { authority: authority.authority } });
  } catch (error) {
    return semanticRouteErrorResponse(error, "INVALID_PARAMS");
  }
}
