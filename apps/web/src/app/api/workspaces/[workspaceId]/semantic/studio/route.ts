import type { NextRequest } from "next/server";
import { handleLoadSemanticStudio } from "@/lib/semantic-studio-route";
import { getSemanticStudioRuntime } from "@/lib/semantic-studio-runtime";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const runtime = await getSemanticStudioRuntime(request, workspaceId, "READ");
  return runtime.ok ? handleLoadSemanticStudio(request, runtime.service) : runtime.response;
}
