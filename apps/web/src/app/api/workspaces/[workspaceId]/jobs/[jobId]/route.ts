import { jobIdempotencyKeySchema } from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceJobQueue } from "@/lib/job-center";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type Context = { params: Promise<{ workspaceId: string; jobId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { workspaceId, jobId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getWorkspaceJobQueue(authorized.value.capability).get({
    scope: authorized.value.capability.scope,
    job_id: jobId,
  });
  if (!result.ok) return workspaceErrorResponse(result.error);
  return result.value
    ? NextResponse.json(result.value, { headers: { "Cache-Control": "no-store" } })
    : workspaceErrorResponse({
        code: "JOB_NOT_FOUND_OR_DENIED",
        message: "Job 不存在或无权访问。",
        retryable: false,
      });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { workspaceId, jobId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const body = z
    .strictObject({ idempotency_key: jobIdempotencyKeySchema })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return workspaceErrorResponse({
      code: "JOB_CANCEL_INPUT_INVALID",
      message: "Job Cancel 输入无效。",
      retryable: false,
    });
  }
  const result = await getWorkspaceJobQueue(authorized.value.capability).requestCancel({
    scope: authorized.value.capability.scope,
    job_id: jobId,
    idempotency_key: body.data.idempotency_key,
  });
  return result.ok
    ? NextResponse.json(result.value, { headers: { "Cache-Control": "no-store" } })
    : workspaceErrorResponse(result.error);
}
