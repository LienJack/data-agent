import { handleGetSchemaSnapshot } from "@/lib/schema-discovery-route";

export function GET(_request: Request, context: { params: Promise<{ snapshotId: string }> }) {
  return handleGetSchemaSnapshot(context.params);
}
