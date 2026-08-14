import { createPostgresRepository } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
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
  const repository = createPostgresRepository(
    getWorkspaceSqlPool(),
    getWorkspaceAuthority().authorizer,
  );
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
  return NextResponse.json(workspaceRunProjection(run.value, binding.value.datasource_id));
}
