import { type NextRequest, NextResponse } from "next/server";
import { bindSemanticImportId, readSemanticJsonBody } from "@/lib/semantic-portability-route";
import { getSemanticPortabilityRepository } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string; importId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, importId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const body = await readSemanticJsonBody(request);
  if (!body.ok) return body.response;
  const result = await getSemanticPortabilityRepository().cancel(
    authorized.value.capability,
    bindSemanticImportId(body.value, importId),
  );
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
