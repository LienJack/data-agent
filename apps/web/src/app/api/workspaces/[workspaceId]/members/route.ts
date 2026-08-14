import type { NextRequest } from "next/server";
import {
  authorizeWorkspaceMembersRequest,
  operationsResultResponse,
} from "@/lib/operations-admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceMembersRequest(request, workspaceId);
  return authorized.ok
    ? operationsResultResponse(
        await authorized.value.repository.listWorkspaceMembers(authorized.value.context),
      )
    : authorized.response;
}
