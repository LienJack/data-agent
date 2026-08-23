import { handleListExplorerDomains } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: import("next/server").NextRequest) {
  const resolved = await getWorkspaceSemanticRuntime(request, {
    feature: "EXPLORER",
    access: "READ",
  });
  return resolved.ok ? handleListExplorerDomains(resolved.runtime) : resolved.response;
}
