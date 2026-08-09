import "server-only";

import type { PortResult } from "@data-agent/contracts";
import {
  immutableIdSchema,
  semanticExplorerErrorCodeSchema,
  semanticExplorerObjectKindSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSemanticExplorerRuntime,
  type SemanticExplorerRuntime,
  SemanticExplorerRuntimeError,
} from "./semantic-explorer-runtime";
import { SemanticGovernanceError } from "./semantic-governance-error";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const domainQuerySchema = z.strictObject({ domain: semanticDomainSchema });
const timelineQuerySchema = domainQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
});
const diffQuerySchema = domainQuerySchema.extend({ base: immutableIdSchema });
const objectQuerySchema = domainQuerySchema.extend({
  kind: semanticExplorerObjectKindSchema,
  releaseId: immutableIdSchema,
});
const lineageQuerySchema = objectQuerySchema.extend({
  direction: z.enum(["upstream", "downstream", "both"]).default("both"),
  hops: z.coerce.number().int().min(1).max(6).default(3),
});
const candidateQuerySchema = domainQuerySchema.extend({ revisionId: immutableIdSchema });

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
} as const;

function queryObject(request: NextRequest): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key in result) throw new z.ZodError([]);
    result[key] = value;
  }
  return result;
}

function statusFor(code: string): number {
  switch (code) {
    case "SEMANTIC_EXPLORER_PERMISSION_DENIED":
    case "SEMANTIC_EXPLORER_OBJECT_NOT_VISIBLE":
    case "SEMANTIC_SCOPE_FORBIDDEN":
      return 403;
    case "SEMANTIC_UNAUTHENTICATED":
      return 401;
    case "SEMANTIC_EXPLORER_RELEASE_NOT_FOUND":
    case "SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID":
      return 404;
    case "SEMANTIC_EXPLORER_LINEAGE_LIMIT_INVALID":
      return 400;
    case "SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH":
    case "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE":
    case "SEMANTIC_EXPLORER_PROJECTION_PAYLOAD_INVALID":
    case "SEMANTIC_EXPLORER_SIDECAR_DIGEST_MISMATCH":
    case "SEMANTIC_EXPLORER_DUPLICATE_IDENTITY":
    case "SEMANTIC_EXPLORER_DANGLING_EDGE":
      return 503;
    default:
      return 503;
  }
}

function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

function resultResponse<T>(result: PortResult<T>): NextResponse {
  if (!result.ok) {
    const parsedCode = semanticExplorerErrorCodeSchema.safeParse(result.error.code);
    const code = parsedCode.success ? parsedCode.data : "SEMANTIC_EXPLORER_UNAVAILABLE";
    return json(
      {
        error: {
          code,
          message: code === result.error.code ? result.error.message : "语义 Explorer 暂时不可用。",
          retryable: code === result.error.code ? result.error.retryable : true,
        },
      },
      statusFor(code),
    );
  }
  return json({ data: result.value, meta: { authority: "POSTGRESQL" } });
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return json(
      {
        error: {
          code: "SEMANTIC_EXPLORER_INVALID_PARAMS",
          message: "请求参数不符合语义 Explorer 契约。",
          retryable: false,
        },
      },
      400,
    );
  }
  if (error instanceof SemanticGovernanceError) {
    const code =
      error.code === "SEMANTIC_SCOPE_FORBIDDEN"
        ? "SEMANTIC_EXPLORER_PERMISSION_DENIED"
        : error.code;
    return json(
      {
        error: {
          code,
          message:
            code === "SEMANTIC_EXPLORER_PERMISSION_DENIED"
              ? "当前 Authority 不允许读取该语义域。"
              : "语义 Explorer 服务端身份不可用。",
          retryable: error.retryable,
        },
      },
      statusFor(code),
    );
  }
  if (error instanceof SemanticExplorerRuntimeError) {
    return json(
      {
        error: {
          code: error.code,
          message: "语义 Explorer 服务端运行时尚未配置。",
          retryable: false,
        },
      },
      503,
    );
  }
  return json(
    {
      error: {
        code: "SEMANTIC_EXPLORER_UNAVAILABLE",
        message: "语义 Explorer 暂时不可用。",
        retryable: true,
      },
    },
    503,
  );
}

function enabledRuntime(runtime: SemanticExplorerRuntime) {
  if (!runtime.enabled) {
    return null;
  }
  return runtime;
}

export async function handleListExplorerDomains(
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) {
      return json(
        {
          error: {
            code: "SEMANTIC_EXPLORER_DISABLED",
            message: "语义 Explorer 当前未启用。",
            retryable: false,
          },
        },
        404,
      );
    }
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: "all",
    });
    return resultResponse(await enabled.service.listDomains(authority));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetActiveExplorerRelease(
  request: NextRequest,
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const query = domainQuerySchema.parse(queryObject(request));
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) return await handleListExplorerDomains(resolvedRuntime);
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(await enabled.service.getActive(authority, query.domain));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleListExplorerReleases(
  request: NextRequest,
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const raw = queryObject(request);
    const query = timelineQuerySchema.parse({ ...raw, cursor: raw.cursor ?? null });
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) return await handleListExplorerDomains(resolvedRuntime);
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(
      await enabled.service.listReleases(authority, query.domain, query.limit, query.cursor),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetExplorerRelease(
  request: NextRequest,
  params: Promise<{ releaseId: string }>,
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const query = domainQuerySchema.parse(queryObject(request));
    const releaseId = immutableIdSchema.parse((await params).releaseId);
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) return await handleListExplorerDomains(resolvedRuntime);
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(await enabled.service.getRelease(authority, query.domain, releaseId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleDiffExplorerReleases(
  request: NextRequest,
  params: Promise<{ releaseId: string }>,
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const query = diffQuerySchema.parse(queryObject(request));
    const targetReleaseId = immutableIdSchema.parse((await params).releaseId);
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) return await handleListExplorerDomains(resolvedRuntime);
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(
      await enabled.service.diffReleases(authority, query.domain, query.base, targetReleaseId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetExplorerObject(
  request: NextRequest,
  params: Promise<{ objectId: string }>,
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const query = objectQuerySchema.parse(queryObject(request));
    const objectId = versionIdentifierSchema.parse((await params).objectId);
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) return await handleListExplorerDomains(resolvedRuntime);
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(
      await enabled.service.getObject(authority, query.domain, query.releaseId, {
        kind: query.kind,
        object_id: objectId,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetExplorerLineage(
  request: NextRequest,
  params: Promise<{ objectId: string }>,
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const query = lineageQuerySchema.parse(queryObject(request));
    const objectId = versionIdentifierSchema.parse((await params).objectId);
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) return await handleListExplorerDomains(resolvedRuntime);
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(
      await enabled.service.getLineage(authority, {
        semantic_domain: query.domain,
        release_id: query.releaseId,
        root: { kind: query.kind, object_id: objectId },
        direction: query.direction,
        hop_limit: query.hops,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetExplorerCandidateComparison(
  request: NextRequest,
  params: Promise<{ candidateId: string }>,
  runtime?: SemanticExplorerRuntime,
): Promise<NextResponse> {
  try {
    const resolvedRuntime = runtime ?? getSemanticExplorerRuntime();
    const query = candidateQuerySchema.parse(queryObject(request));
    const candidateId = immutableIdSchema.parse((await params).candidateId);
    const enabled = enabledRuntime(resolvedRuntime);
    if (!enabled) return await handleListExplorerDomains(resolvedRuntime);
    const authority = await enabled.authorityResolver.resolve({
      access: "READ",
      semanticDomain: query.domain,
    });
    return resultResponse(
      await enabled.service.getCandidateComparison(
        authority,
        query.domain,
        candidateId,
        query.revisionId,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
