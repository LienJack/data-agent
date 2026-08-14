import { handleGetSchemaSnapshot } from "@/lib/schema-discovery-route";
import { getWorkspaceSchemaDiscoveryRuntime } from "@/lib/workspace-semantic-runtime";

export async function GET(
  request: import("next/server").NextRequest,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const resolved = await getWorkspaceSchemaDiscoveryRuntime(request, "READ");
  return resolved.ok
    ? handleGetSchemaSnapshot(context.params, resolved.runtime)
    : resolved.response;
}
