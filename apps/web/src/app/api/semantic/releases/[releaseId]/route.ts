import type { NextRequest } from "next/server";
import { handleGetExplorerRelease } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  return handleGetExplorerRelease(request, params);
}
