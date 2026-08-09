import type { NextRequest } from "next/server";
import { handleGetExplorerLineage } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ objectId: string }> },
) {
  return handleGetExplorerLineage(request, params);
}
