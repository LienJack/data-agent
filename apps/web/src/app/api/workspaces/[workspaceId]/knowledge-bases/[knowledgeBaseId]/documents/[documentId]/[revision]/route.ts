import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getKnowledgeRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = {
  params: Promise<{
    workspaceId: string;
    knowledgeBaseId: string;
    documentId: string;
    revision: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, knowledgeBaseId, documentId, revision } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const parsed = z
    .strictObject({
      knowledge_base_id: z.uuid(),
      document_id: z.uuid(),
      revision: z.coerce.number().int().positive().safe(),
    })
    .safeParse({ knowledge_base_id: knowledgeBaseId, document_id: documentId, revision });
  if (!parsed.success) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_DOCUMENT_GET_INVALID",
      message: "Knowledge Document 引用不符合严格合同。",
      retryable: false,
    });
  }
  const result = await getKnowledgeRegistry().getDocument(
    authorized.value.capability,
    parsed.data.document_id,
    parsed.data.revision,
  );
  if (
    result.ok &&
    result.value.document.knowledge_base_ref.knowledge_base_id !== parsed.data.knowledge_base_id
  ) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_DOCUMENT_NOT_FOUND_OR_DENIED",
      message: "Knowledge Document 不属于当前 Knowledge Base。",
      retryable: false,
    });
  }
  return result.ok
    ? NextResponse.json({ data: result.value }, { headers: { "Cache-Control": "no-store" } })
    : workspaceErrorResponse(result.error);
}
