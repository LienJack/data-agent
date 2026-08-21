import { type NextRequest, NextResponse } from "next/server";
import { getKnowledgeRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = {
  params: Promise<{ workspaceId: string; knowledgeBaseId: string; selectionId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, knowledgeBaseId, selectionId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getKnowledgeRegistry().getEvidenceSelection(
    authorized.value.capability,
    selectionId,
  );
  if (
    result.ok &&
    result.value.selection.knowledge_base_ref.knowledge_base_id !== knowledgeBaseId
  ) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_EVIDENCE_SELECTION_NOT_FOUND_OR_DENIED",
      message: "Evidence Selection 不属于当前 Knowledge Base。",
      retryable: false,
    });
  }
  return result.ok
    ? NextResponse.json(
        { data: result.value },
        { headers: { "Cache-Control": "private, no-store" } },
      )
    : workspaceErrorResponse(result.error);
}
