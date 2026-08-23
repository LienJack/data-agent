import type { NextRequest } from "next/server";
import { handleSaveSemanticCandidateRevision } from "@/lib/semantic-candidate-save-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const runtime = await getWorkspaceSemanticRuntime(request, {
    feature: "CANDIDATE_SAVE",
    access: "WRITE",
    workspaceId,
  });
  return runtime.ok
    ? handleSaveSemanticCandidateRevision(request, runtime.runtime)
    : runtime.response;
}
