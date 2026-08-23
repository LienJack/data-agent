import { NextResponse } from "next/server";
import { testCenterErrorResponse, withWorkspaceTestCenterRequest } from "@/lib/test-center-route";
import { installTestCenterSuite } from "@/lib/test-center-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; suiteId: string }> },
) {
  const { workspaceId, suiteId } = await context.params;
  return withWorkspaceTestCenterRequest(request, workspaceId, "WRITE", async () => {
    try {
      return NextResponse.json({ data: await installTestCenterSuite(suiteId) });
    } catch (error) {
      return testCenterErrorResponse(error);
    }
  });
}
