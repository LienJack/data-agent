import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeQaAdminAuditRequest, qaAdminResultResponse } from "@/lib/qa-admin-audit";

type RouteContext = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

const searchSchema = z.strictObject({
  operation: z.enum(["RUN_REPLAY", "TRAJECTORY_READ", "SUBAGENT_READ"]),
  ownerPrincipalId: z.uuid(),
  runId: z.uuid().nullable(),
  profileId: z.string().min(1).max(128).nullable(),
  taskId: z.uuid().nullable(),
  afterSequence: z.coerce.number().int().nonnegative().safe(),
  limit: z.coerce.number().int().min(1).max(500),
  transport: z.enum(["json", "sse"]),
});

function nullable(value: string | null) {
  return value?.trim() || null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, conversationId } = await context.params;
  const authorized = await authorizeQaAdminAuditRequest(request, workspaceId);
  if (!authorized.ok) return authorized.response;
  const parsed = searchSchema.safeParse({
    operation: request.nextUrl.searchParams.get("operation") ?? "TRAJECTORY_READ",
    ownerPrincipalId: request.nextUrl.searchParams.get("ownerPrincipalId"),
    runId: nullable(request.nextUrl.searchParams.get("runId")),
    profileId: nullable(request.nextUrl.searchParams.get("profileId")),
    taskId: nullable(request.nextUrl.searchParams.get("taskId")),
    afterSequence: request.nextUrl.searchParams.get("afterSequence") ?? 0,
    limit: request.nextUrl.searchParams.get("limit") ?? 500,
    transport: request.nextUrl.searchParams.get("transport") ?? "json",
  });
  if (!parsed.success) {
    return qaAdminResultResponse({
      ok: false,
      error: {
        code: "QA_ADMIN_QUERY_INVALID",
        message: "管理员轨迹查询不符合契约。",
        retryable: false,
      },
    });
  }
  const result = await authorized.value.repository.readRunEvents(authorized.value.capability, {
    schema_version: "qa-admin-run-events-query@1.0.0",
    operation: parsed.data.operation,
    workspace_id: workspaceId,
    owner_principal_id: parsed.data.ownerPrincipalId,
    conversation_id: conversationId,
    run_id: parsed.data.runId,
    profile_id: parsed.data.profileId,
    task_id: parsed.data.taskId,
    after_sequence: parsed.data.afterSequence,
    limit: parsed.data.limit,
  });
  if (!result.ok || parsed.data.transport === "json") return qaAdminResultResponse(result);

  const payload = JSON.stringify(result.value);
  return new Response(`retry: 2000\nevent: replay\ndata: ${payload}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      Connection: "close",
      "X-Accel-Buffering": "no",
    },
  });
}
