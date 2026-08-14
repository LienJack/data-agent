import { createPostgresRepository, createPostgresRunEventStore } from "@data-agent/platform";
import type { NextRequest } from "next/server";
import {
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";
import { workspaceRunProjection } from "@/lib/workspace-run";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const sqlPool = getWorkspaceSqlPool();
  const authorizer = getWorkspaceAuthority().authorizer;
  const repository = createPostgresRepository(sqlPool, authorizer);
  const [run, binding] = await Promise.all([
    repository.getRun(authorized.value.capability, { run_id: runId }),
    getWorkspaceDataRepository().getRunBinding(authorized.value.capability, runId),
  ]);
  if (!run.ok) return workspaceErrorResponse(run.error);
  if (!binding.ok) return workspaceErrorResponse(binding.error);
  if (!run.value || !binding.value) {
    return workspaceErrorResponse({
      code: "WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED",
      message: "Run 不存在或无权访问。",
      retryable: false,
    });
  }
  const eventStore = createPostgresRunEventStore(sqlPool, authorizer, authorized.value.capability);
  const projection = await eventStore.readProjection({
    scope: authorized.value.capability.scope,
    run_id: runId,
  });
  if (!projection.ok) return workspaceErrorResponse(projection.error);
  const publicProjection = workspaceRunProjection(run.value, binding.value.datasource_id);
  const sequence = projection.value?.projection.version ?? 1;
  const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(publicProjection.status);
  const payload = JSON.stringify({
    runId,
    sequence,
    type: terminal ? "terminal" : "projection",
    payload: publicProjection,
    timestamp: publicProjection.updatedAt,
  });
  return new Response(`id: ${sequence}\ndata: ${payload}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store",
      Connection: "keep-alive",
    },
  });
}
