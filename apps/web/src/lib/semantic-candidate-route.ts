import "server-only";

import {
  immutableIdSchema,
  semanticCandidateOperationSchema,
  semanticCompileRequestSchema,
} from "@data-agent/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  type SemanticCandidateRuntime,
  SemanticCandidateRuntimeError,
} from "./semantic-candidate-runtime";
import { SemanticGovernanceError } from "./semantic-governance-error";

const semanticDomainSchema = semanticCompileRequestSchema.shape.semantic_domain;
const submitSchema = z.strictObject({
  schema_version: z.literal("semantic-compile-submit@1.0.0"),
  semantic_domain: semanticDomainSchema,
  selected_operation_ids: z.array(immutableIdSchema).min(1).max(256),
  edited_operations: z.array(semanticCandidateOperationSchema).max(256).optional(),
  idempotency_key: immutableIdSchema,
});

function statusFor(code: string): number {
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("FORBIDDEN") || code.includes("PERMISSION")) return 403;
  if (code.includes("IDEMPOTENCY") || code.includes("STALE") || code.includes("NOT_REVIEWABLE"))
    return 409;
  if (code.includes("INVALID") || code.includes("REQUIRED")) return 400;
  if (code.includes("UNAVAILABLE")) return 503;
  return 500;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "SEMANTIC_CANDIDATE_COMPILE_INVALID",
          message: "请求内容不符合语义候选编译契约。",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof SemanticCandidateRuntimeError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, retryable: false } },
      { status: 503 },
    );
  }
  if (error instanceof SemanticGovernanceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, retryable: error.retryable } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "SEMANTIC_CANDIDATE_COMPILE_UNAVAILABLE",
        message: "语义候选编译当前不可用。",
        retryable: true,
      },
    },
    { status: 503 },
  );
}

function resultResponse<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly message: string;
          readonly retryable: boolean;
        };
      },
  status = 200,
) {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error.code) });
  }
  return NextResponse.json(
    {
      data: result.value,
      meta: { authority: "POSTGRESQL", publication_state: "UNPUBLISHED_CANDIDATE" },
    },
    { status },
  );
}

async function resolveAuthority(
  runtime: SemanticCandidateRuntime,
  access: "READ" | "WRITE",
  semanticDomain: string,
) {
  return runtime.authorityResolver.resolve({ access, semanticDomain });
}

export async function handleCompileSemanticCandidate(
  request: Request,
  runtime: SemanticCandidateRuntime,
) {
  try {
    const input = semanticCompileRequestSchema.parse(await request.json());
    const authority = await resolveAuthority(runtime, "WRITE", input.semantic_domain);
    return resultResponse(await runtime.service.compile(authority, input), 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetSemanticCandidateCompile(
  request: Request,
  params: Promise<{ compileRunId: string }>,
  runtime: SemanticCandidateRuntime,
) {
  try {
    const { compileRunId } = await params;
    const parsedCompileRunId = immutableIdSchema.parse(compileRunId);
    const semanticDomain = semanticDomainSchema.parse(
      new URL(request.url).searchParams.get("semanticDomain"),
    );
    const authority = await resolveAuthority(runtime, "READ", semanticDomain);
    return resultResponse(await runtime.service.get(authority, semanticDomain, parsedCompileRunId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSubmitSemanticCandidateCompile(
  request: Request,
  params: Promise<{ compileRunId: string }>,
  runtime: SemanticCandidateRuntime,
) {
  try {
    const { compileRunId } = await params;
    const parsedCompileRunId = immutableIdSchema.parse(compileRunId);
    const body = submitSchema.parse(await request.json());
    const authority = await resolveAuthority(runtime, "WRITE", body.semantic_domain);
    return resultResponse(
      await runtime.service.submit(authority, {
        semantic_domain: body.semantic_domain,
        compile_run_id: parsedCompileRunId,
        selected_operation_ids: body.selected_operation_ids,
        ...(body.edited_operations ? { edited_operations: body.edited_operations } : {}),
        idempotency_key: body.idempotency_key,
      }),
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
