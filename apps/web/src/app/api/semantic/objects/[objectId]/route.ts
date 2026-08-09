import type { NextRequest } from "next/server";
import { handleGetExplorerObject } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ objectId: string }> },
) {
  return handleGetExplorerObject(request, params);
}
