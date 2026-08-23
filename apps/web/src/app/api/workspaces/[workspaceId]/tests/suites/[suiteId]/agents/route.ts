import { NextResponse } from "next/server";
import { testCenterErrorResponse, withWorkspaceTestCenterRequest } from "@/lib/test-center-route";
import { listTestCenterAgents } from "@/lib/test-center-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; suiteId: string }> },
) {
  const { workspaceId, suiteId } = await context.params;
  return withWorkspaceTestCenterRequest(request, workspaceId, "READ", async () => {
    try {
      return NextResponse.json({ data: await listTestCenterAgents(suiteId) });
    } catch (error) {
      return testCenterErrorResponse(error);
    }
  });
}
