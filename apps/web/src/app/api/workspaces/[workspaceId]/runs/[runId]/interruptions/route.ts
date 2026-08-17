import {
  buildInterruptionReplyCommand,
  interruptionResponseSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getSessionRecovery } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ workspaceId: string; runId: string }> };

const replyInputSchema = z.strictObject({
  idempotency_key: workspaceIdempotencyKeySchema,
  response: interruptionResponseSchema,
});

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getSessionRecovery().loadInterruption(authorized.value.capability, runId);
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = replyInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "INTERRUPTION_REPLY_INVALID",
      message: "澄清回复不符合严格合同。",
      retryable: false,
    });
  }
  const current = await getSessionRecovery().loadInterruption(authorized.value.capability, runId);
  if (!current.ok) return workspaceErrorResponse(current.error);
  if (current.value?.state !== "OPEN") {
    return workspaceErrorResponse({
      code: "RUN_INTERRUPTION_NOT_FOUND_OR_DENIED",
      message: "当前 Run 没有可回复的澄清中断。",
      retryable: false,
    });
  }
  const operationId = deriveIdempotentOperationId({
    operation_kind: "interruption-reply",
    workspace_id: workspaceId,
    principal_id: authorized.value.capability.principal,
    idempotency_key: input.data.idempotency_key,
  });
  const command = await buildInterruptionReplyCommand({
    schema_version: "interruption-reply-command@1.0.0",
    operation_id: operationId,
    idempotency_key: input.data.idempotency_key,
    scope: authorized.value.capability.scope,
    run_id: runId,
    interruption_id: current.value.interruption_id,
    expected_version: current.value.version,
    expected_worker_fence: current.value.worker_fence,
    actor_principal_id: authorized.value.capability.principal,
    response: input.data.response,
    submitted_at: new Date().toISOString(),
  });
  const result = await getSessionRecovery().reply(authorized.value.capability, command);
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
