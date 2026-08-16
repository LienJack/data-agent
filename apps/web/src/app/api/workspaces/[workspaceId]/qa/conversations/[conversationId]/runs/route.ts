import { randomUUID } from "node:crypto";
import { qaRunStartInputSchema } from "@data-agent/contracts";
import { createPostgresRepository } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";
import { workspaceRunProjection } from "@/lib/workspace-run";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = qaRunStartInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "RUN_INPUT_INVALID",
      message: "问题或幂等键不符合契约。",
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
    idempotency_key: input.data.idempotency_key,
    question: input.data.question,
    payload: {
      kind: "START_L2_RESEARCH",
      mode: "L2",
      conversation_id: conversationId,
      message_id: randomUUID(),
    },
  });
  if (!accepted.ok) return workspaceErrorResponse(accepted.error);

  const [persisted, binding] = await Promise.all([
    repository.getRun(authorized.value.capability, { run_id: runId }),
    getWorkspaceDataRepository().getRunBinding(authorized.value.capability, runId),
  ]);
  if (!persisted.ok) return workspaceErrorResponse(persisted.error);
  if (!binding.ok) return workspaceErrorResponse(binding.error);
  if (!persisted.value || !binding.value) {
    return workspaceErrorResponse({
      code: "PERSISTENCE_TRANSACTION_FAILED",
      message: "Run 已接受但当前无法读取权威资源快照。",
      retryable: true,
    });
  }
  return NextResponse.json(workspaceRunProjection(persisted.value, binding.value.datasource_id), {
    status: accepted.value.created ? 201 : 200,
  });
}
