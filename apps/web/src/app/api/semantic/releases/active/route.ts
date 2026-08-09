import type { NextRequest } from "next/server";
import { handleGetActiveExplorerRelease } from "@/lib/semantic-explorer-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleGetActiveExplorerRelease(request);
}
