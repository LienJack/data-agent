import "server-only";

import {
  semanticCandidateRevisionSaveRequestSchema,
  semanticCandidateSelfPublishRequestSchema,
  semanticManualSessionStartRequestSchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SemanticCandidateSaveService } from "./semantic-candidate-save-service";
import { workspaceErrorResponse } from "./workspace-request";

function response<T>(
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
  options: {
    readonly created?: boolean;
    readonly mutation: "START_MANUAL_SESSION" | "EXPLICIT_SAVE" | "SELF_REVIEW_AND_PUBLISH";
  },
) {
  return result.ok
    ? NextResponse.json(
        { data: result.value, meta: { authority: "POSTGRESQL", mutation: options.mutation } },
        { status: options.created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } },
      )
    : workspaceErrorResponse(result.error);
}

function invalid(error: unknown) {
  return workspaceErrorResponse(
    error instanceof z.ZodError || error instanceof SyntaxError
      ? {
          code: "SEMANTIC_CANDIDATE_SAVE_INPUT_INVALID",
          message: "直接编辑或保存草稿请求不符合严格合同。",
          retryable: false,
        }
      : {
          code: "SEMANTIC_CANDIDATE_SAVE_UNAVAILABLE",
          message: "语义草稿服务暂时不可用。",
          retryable: true,
        },
  );
}

export async function handleStartManualSemanticSession(
  request: NextRequest,
  service: SemanticCandidateSaveService,
) {
  try {
    return response(
      await service.startManual(
        semanticManualSessionStartRequestSchema.parse(await request.json()),
      ),
      { created: true, mutation: "START_MANUAL_SESSION" },
    );
  } catch (error) {
    return invalid(error);
  }
}

export async function handleSaveSemanticCandidateRevision(
  request: NextRequest,
  service: SemanticCandidateSaveService,
) {
  try {
    return response(
      await service.save(semanticCandidateRevisionSaveRequestSchema.parse(await request.json())),
      { created: true, mutation: "EXPLICIT_SAVE" },
    );
  } catch (error) {
    return invalid(error);
  }
}

export async function handleSelfPublishSemanticCandidate(
  request: NextRequest,
  service: SemanticCandidateSaveService,
) {
  try {
    return response(
      await service.selfPublish(
        semanticCandidateSelfPublishRequestSchema.parse(await request.json()),
      ),
      { created: true, mutation: "SELF_REVIEW_AND_PUBLISH" },
    );
  } catch (error) {
    return invalid(error);
  }
}
