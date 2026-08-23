import { NextResponse } from "next/server";
import { z } from "zod";
import { testCenterErrorResponse, withWorkspaceTestCenterRequest } from "@/lib/test-center-route";
import { getPersistedTestRun } from "@/lib/test-center-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  const { workspaceId, runId } = await context.params;
  return withWorkspaceTestCenterRequest(request, workspaceId, "READ", async () => {
    try {
      return NextResponse.json({ data: await getPersistedTestRun(z.uuid().parse(runId)) });
    } catch (error) {
      return testCenterErrorResponse(error);
    }
  });
}
