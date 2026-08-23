import type { NextRequest } from "next/server";
import { handleLoadSemanticStudio } from "@/lib/semantic-studio-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const runtime = await getWorkspaceSemanticRuntime(request, {
    feature: "STUDIO",
    access: "READ",
    workspaceId,
  });
  return runtime.ok ? handleLoadSemanticStudio(request, runtime.runtime) : runtime.response;
}
