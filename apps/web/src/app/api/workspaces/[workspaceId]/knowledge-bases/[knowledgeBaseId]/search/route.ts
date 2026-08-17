import { knowledgeDebugSearchRequestSchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { getKnowledgeSearchService } from "@/lib/knowledge-runtime";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string; knowledgeBaseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, knowledgeBaseId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = knowledgeDebugSearchRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.knowledge_base_ref.knowledge_base_id !== knowledgeBaseId) {
    return workspaceErrorResponse({
      code: "KNOWLEDGE_SEARCH_REQUEST_INVALID",
      message: "Knowledge 调试检索必须绑定当前 Base 与 Generation。",
      retryable: false,
    });
  }
  const search = await getKnowledgeSearchService(authorized.value.capability);
  const result = await search.search(input.data, request.signal);
  return result.ok
    ? NextResponse.json({ data: result.value }, { headers: { "Cache-Control": "no-store" } })
    : workspaceErrorResponse(result.error);
}
