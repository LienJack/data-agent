import type { NextRequest } from "next/server";
import { handleSelfPublishSemanticCandidate } from "@/lib/semantic-candidate-save-route";
import { getSemanticCandidateSaveRuntime } from "@/lib/semantic-candidate-save-runtime";

export async function POST(
  request: NextRequest,
  context: { readonly params: Promise<{ readonly workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  const runtime = await getSemanticCandidateSaveRuntime(request, workspaceId);
  if (!runtime.ok) return runtime.response;
  return handleSelfPublishSemanticCandidate(request, runtime.service);
}
