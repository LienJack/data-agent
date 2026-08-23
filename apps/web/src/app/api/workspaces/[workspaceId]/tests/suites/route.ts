import { NextResponse } from "next/server";
import { testCenterErrorResponse, withWorkspaceTestCenterRequest } from "@/lib/test-center-route";
import { listTestCenterSuites } from "@/lib/test-center-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return withWorkspaceTestCenterRequest(request, workspaceId, "READ", async () => {
    try {
      return NextResponse.json({ data: await listTestCenterSuites() });
    } catch (error) {
      return testCenterErrorResponse(error);
    }
  });
}
