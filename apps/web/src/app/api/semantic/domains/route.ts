import { handleListExplorerDomains } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticExplorerRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: import("next/server").NextRequest) {
  const resolved = await getWorkspaceSemanticExplorerRuntime(request);
  return resolved.ok ? handleListExplorerDomains(resolved.runtime) : resolved.response;
}
