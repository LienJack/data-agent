import type { NextRequest } from "next/server";
import { handleDiffExplorerReleases } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  const resolved = await getWorkspaceSemanticRuntime(request, {
    feature: "EXPLORER",
    access: "READ",
  });
  return resolved.ok
    ? handleDiffExplorerReleases(request, params, resolved.runtime)
    : resolved.response;
}
