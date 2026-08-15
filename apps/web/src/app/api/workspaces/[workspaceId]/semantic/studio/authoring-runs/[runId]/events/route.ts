import type { NextRequest } from "next/server";
import { handleStreamSemanticAuthoringRun } from "@/lib/semantic-studio-route";
import { getSemanticStudioRuntime } from "@/lib/semantic-studio-runtime";

type RouteContext = { params: Promise<{ workspaceId: string; runId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const runtime = await getSemanticStudioRuntime(request, workspaceId, "READ");
  return runtime.ok
    ? handleStreamSemanticAuthoringRun(request, runId, runtime.service)
    : runtime.response;
}
