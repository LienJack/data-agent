import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceJobQueue } from "@/lib/job-center";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .safeParse(request.nextUrl.searchParams.get("limit") ?? 50);
  const after = request.nextUrl.searchParams.get("after_job_id") ?? undefined;
  if (!limit.success) {
    return workspaceErrorResponse({
      code: "JOB_LIST_INPUT_INVALID",
      message: "Job 列表参数无效。",
      retryable: false,
    });
  }
  const result = await getWorkspaceJobQueue(authorized.value.capability).list({
    scope: authorized.value.capability.scope,
    limit: limit.data,
    ...(after ? { after_job_id: after } : {}),
  });
  return result.ok
    ? NextResponse.json({ jobs: result.value }, { headers: { "Cache-Control": "no-store" } })
    : workspaceErrorResponse(result.error);
}
