import {
  authorityEpochForFalcon24Gate,
  falcon24AcceptanceCampaignIdSchema,
  falcon24QualificationGateIdSchema,
} from "@data-agent/contracts/evals";
import { falcon24AuthorityEpochSchema } from "@data-agent/contracts/runs";
import {
  qaRunStartInputSchema,
  workspaceFileReferenceSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts/workspaces";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";
import { startQuestionRun } from "./start-question-run";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

const effectiveConfigQaRunStartInputSchema = qaRunStartInputSchema.extend({
  idempotency_key: workspaceIdempotencyKeySchema,
  files: z.array(workspaceFileReferenceSchema).max(16).default([]),
  acceptance_fence: z
    .discriminatedUnion("authority_kind", [
      z.strictObject({
        authority_kind: z.literal("QUALIFICATION"),
        authority_epoch: falcon24AuthorityEpochSchema,
        qualification_id: falcon24QualificationGateIdSchema,
        attempt_id: z.uuid(),
        run_id: z.uuid(),
        claim_fence_token: z.uuid(),
      }),
      z.strictObject({
        authority_kind: z.literal("FINAL_CAMPAIGN"),
        authority_epoch: falcon24AuthorityEpochSchema,
        campaign_id: falcon24AcceptanceCampaignIdSchema,
        attempt_id: z.uuid(),
        run_id: z.uuid(),
        claim_fence_token: z.uuid(),
      }),
    ])
    .superRefine((fence, context) => {
      const gateId =
        fence.authority_kind === "QUALIFICATION" ? fence.qualification_id : fence.campaign_id;
      if (authorityEpochForFalcon24Gate(gateId) !== fence.authority_epoch) {
        context.addIssue({
          code: "custom",
          message: "Falcon24 browser fence authority epoch 与 gate ID 不一致。",
          path: [fence.authority_kind === "QUALIFICATION" ? "qualification_id" : "campaign_id"],
        });
      }
    })
    .optional(),
});

export interface QuestionRunRouteDependencies {
  readonly authorize: typeof authorizeWorkspaceRequest;
  readonly execute: typeof startQuestionRun;
  readonly projectError: typeof workspaceErrorResponse;
}

export function createQuestionRunRoute(
  dependencies: QuestionRunRouteDependencies = {
    authorize: authorizeWorkspaceRequest,
    execute: startQuestionRun,
    projectError: workspaceErrorResponse,
  },
) {
  return async function post(request: NextRequest, context: RouteContext) {
    const { workspaceId, conversationId } = await context.params;
    const authorized = await dependencies.authorize(request, workspaceId, "WRITE");
    if (!authorized.ok) return dependencies.projectError(authorized.error);

    const input = effectiveConfigQaRunStartInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) {
      return dependencies.projectError({
        code: "RUN_INPUT_INVALID",
        message: "问题或幂等键不符合契约。",
        retryable: false,
      });
    }
    const parsedConversationId = z.uuid().safeParse(conversationId);
    if (!parsedConversationId.success) {
      return dependencies.projectError({
        code: "CONVERSATION_NOT_FOUND_OR_DENIED",
        message: "对话不存在或无权访问。",
        retryable: false,
      });
    }

    const result = await dependencies.execute({
      capability: authorized.value.capability,
      conversation_id: parsedConversationId.data,
      files: input.data.files,
      idempotency_key: input.data.idempotency_key,
      principal_id: authorized.value.capability.principal,
      question: input.data.question,
      scope: authorized.value.capability.scope,
      workspace_id: workspaceId,
      ...(input.data.acceptance_fence ? { acceptance_fence: input.data.acceptance_fence } : {}),
    });
    if (result.kind === "ERROR") return dependencies.projectError(result.error);
    if (result.kind === "RESOLUTION_REQUIRED") {
      return NextResponse.json({ resolution: result.resolution }, { status: 409 });
    }
    return NextResponse.json(result.projection, { status: 201 });
  };
}

export const questionRunPost = createQuestionRunRoute();
