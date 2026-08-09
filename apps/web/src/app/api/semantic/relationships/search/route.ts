import type { NextRequest } from "next/server";
import { handleSearchExplorerRelationships } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleSearchExplorerRelationships(request);
}
