import type { NextRequest } from "next/server";
import { handleGetExplorerLineage } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticExplorerRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ objectId: string }> },
) {
  const resolved = await getWorkspaceSemanticExplorerRuntime(request);
  return resolved.ok
    ? handleGetExplorerLineage(request, params, resolved.runtime)
    : resolved.response;
}
