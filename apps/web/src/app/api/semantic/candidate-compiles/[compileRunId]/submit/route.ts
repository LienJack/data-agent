import { handleSubmitSemanticCandidateCompile } from "@/lib/semantic-candidate-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ compileRunId: string }> },
) {
  const resolved = await getWorkspaceSemanticRuntime(request as import("next/server").NextRequest, {
    feature: "CANDIDATE",
    access: "WRITE",
  });
  return resolved.ok
    ? handleSubmitSemanticCandidateCompile(request, params, resolved.runtime)
    : resolved.response;
}
