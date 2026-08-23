import {
  buildSessionBranch,
  buildSessionBranchCommand,
  effectiveConfigRevalidationReferenceSchema,
  snapshotReferenceSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getSessionRecovery } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ workspaceId: string; runId: string }> };

const branchInputSchema = z.strictObject({
  idempotency_key: workspaceIdempotencyKeySchema,
  parent_conversation_id: z.uuid(),
  parent_event_sequence: z.number().int().positive().safe(),
  parent_checkpoint_ref: snapshotReferenceSchema,
  effective_config_revalidation: effectiveConfigRevalidationReferenceSchema,
  child_conversation_id: z.uuid(),
});

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getSessionRecovery().listBranches(authorized.value.capability, runId);
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = branchInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "SESSION_BRANCH_COMMAND_INVALID",
      message: "Session Branch 请求不符合严格合同。",
      retryable: false,
    });
  }
  const operationId = deriveIdempotentOperationId({
    operation_kind: "session-branch",
    workspace_id: workspaceId,
    principal_id: authorized.value.capability.principal,
    idempotency_key: input.data.idempotency_key,
  });
  const branch = await buildSessionBranch({
    schema_version: "session-branch@1.0.0",
    scope: authorized.value.capability.scope,
    branch_id: operationId,
    parent_conversation_id: input.data.parent_conversation_id,
    parent_run_id: runId,
    parent_event_sequence: input.data.parent_event_sequence,
    parent_checkpoint_ref: input.data.parent_checkpoint_ref,
    effective_config_revalidation: input.data.effective_config_revalidation,
    child_conversation_id: input.data.child_conversation_id,
    created_by_principal_id: authorized.value.capability.principal,
    created_at: new Date().toISOString(),
  });
  const command = await buildSessionBranchCommand({
    schema_version: "session-branch-command@1.0.0",
    operation_id: operationId,
    idempotency_key: input.data.idempotency_key,
    branch,
  });
  const result = await getSessionRecovery().createBranch(authorized.value.capability, command);
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 201 })
    : workspaceErrorResponse(result.error);
}
