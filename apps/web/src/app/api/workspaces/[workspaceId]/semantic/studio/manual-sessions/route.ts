import type { NextRequest } from "next/server";
import { handleStartManualSemanticSession } from "@/lib/semantic-candidate-save-route";
import { getSemanticCandidateSaveRuntime } from "@/lib/semantic-candidate-save-runtime";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const runtime = await getSemanticCandidateSaveRuntime(request, workspaceId);
  return runtime.ok ? handleStartManualSemanticSession(request, runtime.service) : runtime.response;
}
