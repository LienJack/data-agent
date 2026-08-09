import type { NextRequest } from "next/server";
import { handleDiffExplorerReleases } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  return handleDiffExplorerReleases(request, params);
}
