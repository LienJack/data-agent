import type { NextRequest } from "next/server";
import { handleListExplorerReleases } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticExplorerRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const resolved = await getWorkspaceSemanticExplorerRuntime(request);
  return resolved.ok ? handleListExplorerReleases(request, resolved.runtime) : resolved.response;
}
