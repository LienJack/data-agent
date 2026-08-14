import { randomUUID } from "node:crypto";
import { createPostgresRepository } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";
import { workspaceRunProjection } from "@/lib/workspace-run";

const createRunSchema = z.strictObject({
  question: z.string().trim().min(1).max(4_000),
  idempotencyKey: z.string().min(1).max(256),
  datasourceId: z.uuid(),
  conversationId: z.uuid(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = createRunSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "RUN_DATASOURCE_BINDING_INVALID",
      message: "Run 必须显式绑定当前工作空间的数据源和对话。",
      retryable: false,
    });
  }
  const workspaceData = getWorkspaceDataRepository();
  const [source, conversation] = await Promise.all([
    workspaceData.getDatasource(authorized.value.capability, input.data.datasourceId),
    workspaceData.getConversation(authorized.value.capability, input.data.conversationId),
  ]);
  if (!source.ok) return workspaceErrorResponse(source.error);
  if (!conversation.ok) return workspaceErrorResponse(conversation.error);
  if (
    source.value?.status !== "ACTIVE" ||
    !conversation.value ||
    conversation.value.datasource_id !== source.value.datasource_id
  ) {
    return workspaceErrorResponse({
      code: "RUN_DATASOURCE_BINDING_INVALID",
      message: "Run 的数据源或对话不属于当前工作空间。",
      retryable: false,
    });
  }

  const runId = randomUUID();
  const repository = createPostgresRepository(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
  );
  const accepted = await repository.acceptCommand(authorized.value.capability, {
    run_id: runId,
    command_id: randomUUID(),
    event_id: randomUUID(),
    outbox_id: randomUUID(),
    audit_id: randomUUID(),
    idempotency_key: input.data.idempotencyKey,
    question: input.data.question,
    payload: {
      kind: "START_L2_RESEARCH",
      mode: "L2",
      datasource_id: input.data.datasourceId,
      conversation_id: input.data.conversationId,
    },
  });
  if (!accepted.ok) return workspaceErrorResponse(accepted.error);
  const persisted = await repository.getRun(authorized.value.capability, { run_id: runId });
  if (!persisted.ok) return workspaceErrorResponse(persisted.error);
  if (!persisted.value) {
    return workspaceErrorResponse({
      code: "PERSISTENCE_TRANSACTION_FAILED",
      message: "Run 已接受但当前无法读取权威投影。",
      retryable: true,
    });
  }
  return NextResponse.json(workspaceRunProjection(persisted.value, input.data.datasourceId), {
    status: accepted.value.created ? 201 : 200,
  });
}
