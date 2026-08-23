import type { NextRequest } from "next/server";
import { handleGetActiveExplorerRelease } from "@/lib/semantic-explorer-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const resolved = await getWorkspaceSemanticRuntime(request, {
    feature: "EXPLORER",
    access: "READ",
  });
  return resolved.ok
    ? handleGetActiveExplorerRelease(request, resolved.runtime)
    : resolved.response;
}
