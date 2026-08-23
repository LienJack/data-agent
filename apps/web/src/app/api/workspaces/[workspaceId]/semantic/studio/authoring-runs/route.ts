import type { NextRequest } from "next/server";
import { handleStartSemanticAuthoring } from "@/lib/semantic-studio-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const runtime = await getWorkspaceSemanticRuntime(request, {
    feature: "STUDIO",
    access: "WRITE",
    workspaceId,
  });
  return runtime.ok ? handleStartSemanticAuthoring(request, runtime.runtime) : runtime.response;
}
