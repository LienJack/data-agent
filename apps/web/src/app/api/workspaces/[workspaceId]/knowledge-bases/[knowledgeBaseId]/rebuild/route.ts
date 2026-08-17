import {
  buildKnowledgeBaseRebuildCommand,
  knowledgeBaseReferenceSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getKnowledgeRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string; knowledgeBaseId: string }> };

const inputSchema = z.strictObject({
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, knowledgeBaseId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.knowledge_base_ref.knowledge_base_id !== knowledgeBaseId) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_BASE_REBUILD_INPUT_INVALID",
      message: "Knowledge Base 重建请求未绑定当前 exact revision。",
      retryable: false,
    });
  }
  const command = await buildKnowledgeBaseRebuildCommand({
    schema_version: "knowledge-base-rebuild@1.0.0",
    operation_id: deriveIdempotentOperationId({
      operation_kind: "knowledge-base-rebuild",
      workspace_id: workspaceId,
      principal_id: authorized.value.capability.principal,
      idempotency_key: input.data.idempotency_key,
    }),
    workspace_id: workspaceId,
    ...input.data,
  });
  const result = await getKnowledgeRegistry().rebuild(authorized.value.capability, command);
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 202 })
    : workspaceErrorResponse(result.error);
}
