import type { NextRequest } from "next/server";
import { handleStartSemanticAuthoring } from "@/lib/semantic-studio-route";
import { getSemanticStudioRuntime } from "@/lib/semantic-studio-runtime";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const runtime = await getSemanticStudioRuntime(request, workspaceId, "WRITE");
  return runtime.ok ? handleStartSemanticAuthoring(request, runtime.service) : runtime.response;
}
