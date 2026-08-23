import { NextResponse } from "next/server";
import { z } from "zod";
import { testCenterErrorResponse, withWorkspaceTestCenterRequest } from "@/lib/test-center-route";
import { executeTestCenterRun } from "@/lib/test-center-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idempotencyKeySchema = z.uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  return withWorkspaceTestCenterRequest(request, workspaceId, "WRITE", async () => {
    try {
      const idempotencyKey = idempotencyKeySchema.parse(request.headers.get("idempotency-key"));
      const run = await executeTestCenterRun(await request.json(), idempotencyKey);
      return NextResponse.json({ data: run }, { status: 201 });
    } catch (error) {
      return testCenterErrorResponse(error);
    }
  });
}
