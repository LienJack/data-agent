import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getKnowledgeRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string; knowledgeBaseId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, knowledgeBaseId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const parsedKnowledgeBaseId = z.uuid().safeParse(knowledgeBaseId);
  if (!parsedKnowledgeBaseId.success) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_DOCUMENT_LIST_INVALID",
      message: "Knowledge Base 标识不符合严格合同。",
      retryable: false,
    });
  }
  const result = await getKnowledgeRegistry().listDocuments(
    authorized.value.capability,
    parsedKnowledgeBaseId.data,
    200,
  );
  return result.ok
    ? NextResponse.json({ data: result.value }, { headers: { "Cache-Control": "no-store" } })
    : workspaceErrorResponse(result.error);
}
