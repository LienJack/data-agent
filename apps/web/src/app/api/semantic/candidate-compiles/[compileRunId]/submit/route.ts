import { handleSubmitSemanticCandidateCompile } from "@/lib/semantic-candidate-route";
import { getWorkspaceSemanticCandidateRuntime } from "@/lib/workspace-semantic-runtime";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ compileRunId: string }> },
) {
  const resolved = await getWorkspaceSemanticCandidateRuntime(
    request as import("next/server").NextRequest,
    "WRITE",
  );
  return resolved.ok
    ? handleSubmitSemanticCandidateCompile(request, params, resolved.runtime)
    : resolved.response;
}
