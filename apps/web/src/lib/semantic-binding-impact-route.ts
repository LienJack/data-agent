import "server-only";

import {
  immutableIdSchema,
  type PortResult,
  type SemanticBindingImpactSafeProjection,
  semanticBindingImpactSafeProjectionSchema,
} from "@data-agent/contracts";
import type { SemanticBindingImpactService } from "@data-agent/semantic/application";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SemanticAuthorityResolver } from "./semantic-authority";
import { semanticRouteErrorResponse } from "./semantic-governance-route";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u);
const querySchema = z.strictObject({ domain: semanticDomainSchema });

export interface SemanticBindingImpactRuntime {
  readonly authorityResolver: SemanticAuthorityResolver;
  readonly service: SemanticBindingImpactService;
}

function queryObject(request: NextRequest): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key in result) throw new z.ZodError([]);
    result[key] = value;
  }
  return result;
}

function statusFor(code: string): number {
  if (code.includes("SCOPE") || code.includes("FORBIDDEN")) return 403;
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("INVALID") || code.includes("REQUIRED")) return 400;
  return 503;
}

function resultResponse(result: PortResult<SemanticBindingImpactSafeProjection>): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: statusFor(result.error.code), headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const projection = semanticBindingImpactSafeProjectionSchema.safeParse(result.value);
  if (!projection.success) {
    return NextResponse.json(
      {
        error: {
          code: "SEMANTIC_BINDING_IMPACT_PROJECTION_INVALID",
          message: "Binding Impact 安全投影不符合公开契约。",
          retryable: true,
        },
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    { data: projection.data, meta: { authority: "POSTGRESQL" } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function handleGetSemanticBindingImpact(
  request: NextRequest,
  params: Promise<{ impactId: string }>,
  runtime: SemanticBindingImpactRuntime,
): Promise<NextResponse> {
  try {
    const query = querySchema.parse(queryObject(request));
    const impactId = immutableIdSchema.parse((await params).impactId);
    const authority = await runtime.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(
      await runtime.service.get(authority, {
        semantic_domain: query.domain,
        impact_id: impactId,
      }),
    );
  } catch (error) {
    const response =
      error instanceof z.ZodError
        ? NextResponse.json(
            {
              error: {
                code: "SEMANTIC_BINDING_IMPACT_REQUEST_INVALID",
                message: "Binding Impact 请求参数不符合公开契约。",
                retryable: false,
              },
            },
            { status: 400 },
          )
        : semanticRouteErrorResponse(error, "INVALID_PARAMS");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
