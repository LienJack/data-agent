import type { NextRequest } from "next/server";
import { handleGetExplorerCandidateComparison } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticExplorerRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const resolved = await getWorkspaceSemanticExplorerRuntime(request);
  return resolved.ok
    ? handleGetExplorerCandidateComparison(request, params, resolved.runtime)
    : resolved.response;
}
