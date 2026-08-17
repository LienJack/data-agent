import { handleGetSemanticCandidateCompile } from "@/lib/semantic-candidate-route";
import { getWorkspaceSemanticCandidateRuntime } from "@/lib/workspace-semantic-runtime";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ compileRunId: string }> },
) {
  const resolved = await getWorkspaceSemanticCandidateRuntime(
    request as import("next/server").NextRequest,
    "READ",
  );
  return resolved.ok
    ? handleGetSemanticCandidateCompile(request, params, resolved.runtime)
    : resolved.response;
}
