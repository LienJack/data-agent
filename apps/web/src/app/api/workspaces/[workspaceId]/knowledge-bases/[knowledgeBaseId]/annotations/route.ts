import {
  buildKnowledgeCorrectionAnnotation,
  knowledgeBaseReferenceSchema,
  knowledgeDocumentBlockReferenceSchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getKnowledgeRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string; knowledgeBaseId: string }> };

const inputSchema = z.strictObject({
  knowledge_base_ref: knowledgeBaseReferenceSchema,
  block_ref: knowledgeDocumentBlockReferenceSchema,
  annotation_kind: z.enum(["CORRECTION", "SUPPLEMENT"]),
  correction_text: z.string().trim().min(1).max(20_000),
  reason: z.string().trim().min(1).max(2_000),
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, knowledgeBaseId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.knowledge_base_ref.knowledge_base_id !== knowledgeBaseId) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_CORRECTION_ANNOTATION_INVALID",
      message: "纠错注释必须绑定当前 Knowledge Base Revision 与 exact Block。",
      retryable: false,
    });
  }
  const annotation = await buildKnowledgeCorrectionAnnotation({
    schema_version: "knowledge-correction-annotation@1.0.0",
    annotation_id: crypto.randomUUID(),
    scope: authorized.value.capability.scope,
    ...input.data,
    effective_knowledge_base_revision: input.data.knowledge_base_ref.revision,
    created_by_principal_id: authorized.value.capability.principal,
    created_at: new Date().toISOString(),
  });
  const result = await getKnowledgeRegistry().createCorrectionAnnotation(
    authorized.value.capability,
    annotation,
  );
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 201 })
    : workspaceErrorResponse(result.error);
}
