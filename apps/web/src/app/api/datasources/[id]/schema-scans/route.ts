import type { NextRequest } from "next/server";
import { handleStartSchemaScan } from "@/lib/schema-discovery-route";

export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleStartSchemaScan(request, context.params);
}
