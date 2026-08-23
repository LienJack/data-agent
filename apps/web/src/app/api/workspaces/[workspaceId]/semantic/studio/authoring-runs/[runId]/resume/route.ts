import type { NextRequest } from "next/server";
import { handleResumeSemanticAuthoring } from "@/lib/semantic-studio-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

type RouteContext = { params: Promise<{ workspaceId: string; runId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId, runId } = await context.params;
  const runtime = await getWorkspaceSemanticRuntime(request, {
    feature: "STUDIO",
    access: "WRITE",
    workspaceId,
  });
  return runtime.ok
    ? handleResumeSemanticAuthoring(request, runId, runtime.runtime)
    : runtime.response;
}
