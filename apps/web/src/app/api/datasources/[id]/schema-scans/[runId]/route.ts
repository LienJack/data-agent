import { handleGetSchemaScan } from "@/lib/schema-discovery-route";

export function GET(
  _request: Request,
  context: { params: Promise<{ id: string; runId: string }> },
) {
  return handleGetSchemaScan(context.params);
}
