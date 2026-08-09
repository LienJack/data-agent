import { handleGetSchemaDiff } from "@/lib/schema-discovery-route";

export function GET(request: Request, context: { params: Promise<{ snapshotId: string }> }) {
  return handleGetSchemaDiff(request, context.params);
}
