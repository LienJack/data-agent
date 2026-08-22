import {
  buildKnowledgeEvidenceSelection,
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
  intended_semantic_domain: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  block_refs: z.array(knowledgeDocumentBlockReferenceSchema).min(1).max(256),
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, knowledgeBaseId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.knowledge_base_ref.knowledge_base_id !== knowledgeBaseId) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_EVIDENCE_SELECTION_INVALID",
      message: "段落选择必须绑定当前 Knowledge Base 的 exact Revision。",
      retryable: false,
    });
  }
  let selection: Awaited<ReturnType<typeof buildKnowledgeEvidenceSelection>>;
  try {
    selection = await buildKnowledgeEvidenceSelection({
      schema_version: "knowledge-evidence-selection@1.0.0",
      selection_id: crypto.randomUUID(),
      scope: authorized.value.capability.scope,
      knowledge_base_ref: input.data.knowledge_base_ref,
      intended_semantic_domain: input.data.intended_semantic_domain,
      block_refs: input.data.block_refs,
      selected_by_principal_id: authorized.value.capability.principal,
      selected_at: new Date().toISOString(),
    });
  } catch {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_EVIDENCE_SELECTION_INVALID",
      message: "段落引用必须唯一并按稳定身份排序。",
      retryable: false,
    });
  }
  const result = await getKnowledgeRegistry().createEvidenceSelection(
    authorized.value.capability,
    selection,
  );
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 201 })
    : workspaceErrorResponse(result.error);
}
