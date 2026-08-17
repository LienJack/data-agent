import {
  buildKnowledgeBaseCreateCommand,
  embeddingProfileReferenceSchema,
  knowledgeAclSchema,
  workspaceFileReferenceSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getKnowledgeRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const createInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  source_file_refs: z.array(workspaceFileReferenceSchema).min(1).max(128),
  embedding_profile_ref: embeddingProfileReferenceSchema,
  acl: knowledgeAclSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
});

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const registry = getKnowledgeRegistry();
  const [knowledgeBases, profiles] = await Promise.all([
    registry.list(authorized.value.capability, 100),
    registry.listProfiles(authorized.value.capability, 100),
  ]);
  if (!knowledgeBases.ok) return workspaceErrorResponse(knowledgeBases.error);
  if (!profiles.ok) return workspaceErrorResponse(profiles.error);
  return NextResponse.json(
    { data: { knowledge_bases: knowledgeBases.value, embedding_profiles: profiles.value } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = createInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_BASE_CREATE_INPUT_INVALID",
      message: "Knowledge Base 创建请求不符合严格合同。",
      retryable: false,
    });
  }
  const command = await buildKnowledgeBaseCreateCommand({
    schema_version: "knowledge-base-create@1.0.0",
    operation_id: deriveIdempotentOperationId({
      operation_kind: "knowledge-base-create",
      workspace_id: workspaceId,
      principal_id: authorized.value.capability.principal,
      idempotency_key: input.data.idempotency_key,
    }),
    workspace_id: workspaceId,
    ...input.data,
  });
  const result = await getKnowledgeRegistry().create(authorized.value.capability, command);
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 202 })
    : workspaceErrorResponse(result.error);
}
