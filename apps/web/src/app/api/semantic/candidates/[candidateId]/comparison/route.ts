import type { NextRequest } from "next/server";
import { handleGetExplorerCandidateComparison } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  return handleGetExplorerCandidateComparison(request, params);
}
