import { handleGetSchemaDiff } from "@/lib/schema-discovery-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export async function GET(
  request: import("next/server").NextRequest,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const resolved = await getWorkspaceSemanticRuntime(request, {
    feature: "SCHEMA_DISCOVERY",
    access: "READ",
  });
  return resolved.ok
    ? handleGetSchemaDiff(request, context.params, resolved.runtime)
    : resolved.response;
}
