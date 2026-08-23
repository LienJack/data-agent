import { randomUUID } from "node:crypto";
import { createPostgresRunControl } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceAuthority, getWorkspaceSqlPool } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

const inputSchema = z.strictObject({
  commandId: z.uuid(),
  type: z.enum(["cancel", "resume"]),
});

type RouteContext = { params: Promise<{ workspaceId: string; runId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "RUN_CONTROL_INPUT_INVALID",
      message: "Run 控制命令不符合契约。",
      retryable: false,
    });
  }
  const now = new Date().toISOString();
  const result = await createPostgresRunControl(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
    authorized.value.capability,
  ).submit({
    schema_version: "1.0.0",
    scope: authorized.value.capability.scope,
    operation: input.data.type === "cancel" ? "CANCEL" : "RESUME",
    run_id: runId,
    command_id: input.data.commandId,
    event_id: randomUUID(),
    outbox_id: randomUUID(),
    audit_id: randomUUID(),
    idempotency_key: `run-control:${input.data.commandId}`,
    occurred_at: now,
  });
  return result.ok
    ? NextResponse.json({ data: { status: result.value.projection.status } })
    : workspaceErrorResponse(result.error);
}
