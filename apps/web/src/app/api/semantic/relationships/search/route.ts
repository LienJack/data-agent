import type { NextRequest } from "next/server";
import { handleSearchExplorerRelationships } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticExplorerRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const resolved = await getWorkspaceSemanticExplorerRuntime(request);
  return resolved.ok
    ? handleSearchExplorerRelationships(request, resolved.runtime)
    : resolved.response;
}
