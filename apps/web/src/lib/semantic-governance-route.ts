import "server-only";
import {
  type PortResult,
  semanticCandidateDraftSchema,
  semanticCommitPublishInputSchema,
  semanticPreparePublishInputSchema,
  semanticRollbackInputSchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  publicSemanticGovernanceError,
  redactSemanticGovernanceError,
  SemanticGovernanceError,
} from "./semantic-governance-error";
import { getWorkspaceSemanticRuntime } from "./workspace-semantic-runtime";

class WorkspaceSemanticRouteError extends Error {
  override readonly name = "WorkspaceSemanticRouteError";
  constructor(readonly response: NextResponse) {
    super("Workspace semantic request authority failed.");
  }
}

const semanticPublishRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("prepare"), input: semanticPreparePublishInputSchema }),
  z.strictObject({ action: z.literal("commit"), input: semanticCommitPublishInputSchema }),
]);

export function parseSemanticCandidateRequest(input: unknown) {
  const parsed = semanticCandidateDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw publicSemanticGovernanceError("SEMANTIC_CANDIDATE_INVALID");
  }
  return parsed.data;
}

export function parseSemanticPublishRequest(input: unknown) {
  const parsed = semanticPublishRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw publicSemanticGovernanceError("SEMANTIC_PUBLISH_MATERIAL_REQUIRED");
  }
  return parsed.data;
}

export function parseSemanticRollbackRequest(input: unknown) {
  const parsed = semanticRollbackInputSchema.safeParse(input);
  if (!parsed.success) {
    throw publicSemanticGovernanceError("SEMANTIC_ROLLBACK_AUTHORIZATION_REQUIRED");
  }
  return parsed.data;
}

export async function resolveSemanticRouteAuthority(
  request: NextRequest,
  access: "READ" | "WRITE",
  semanticDomain: string,
) {
  const resolved = await getWorkspaceSemanticRuntime(request, {
    feature: "GOVERNANCE",
    access,
  });
  if (!resolved.ok) throw new WorkspaceSemanticRouteError(resolved.response);
  const runtime = resolved.runtime;
  const authority = await runtime.authorityResolver.resolve({
    access,
    semanticDomain,
  });
  return { runtime, authority };
}

export function semanticRouteErrorResponse(
  error: unknown,
  invalidCode: "INVALID_PARAMS" | "INVALID_BODY",
): NextResponse {
  if (error instanceof WorkspaceSemanticRouteError) return error.response;
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: invalidCode, message: "请求内容不符合语义治理契约。" } },
      { status: 400 },
    );
  }

  const publicError =
    error instanceof SemanticGovernanceError
      ? redactSemanticGovernanceError(error)
      : redactSemanticGovernanceError(undefined);
  return NextResponse.json(
    {
      error: {
        code: publicError.code,
        message: publicError.message,
        retryable: publicError.retryable,
      },
    },
    { status: publicError.status },
  );
}

function governanceStatus(code: string): number {
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("FORBIDDEN")) return 403;
  if (code.includes("CONFLICT")) return 409;
  if (code.includes("INVALID") || code.includes("REQUIRED")) return 400;
  return 503;
}

export function semanticGovernanceResultResponse<T>(
  result: PortResult<T>,
  successStatus = 200,
): NextResponse {
  return result.ok
    ? NextResponse.json(
        { data: result.value, meta: { authority: "POSTGRESQL" } },
        { status: successStatus },
      )
    : NextResponse.json({ error: result.error }, { status: governanceStatus(result.error.code) });
}
