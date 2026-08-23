import { handleGetSemanticCandidateCompile } from "@/lib/semantic-candidate-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ compileRunId: string }> },
) {
  const resolved = await getWorkspaceSemanticRuntime(request as import("next/server").NextRequest, {
    feature: "CANDIDATE",
    access: "READ",
  });
  return resolved.ok
    ? handleGetSemanticCandidateCompile(request, params, resolved.runtime)
    : resolved.response;
}
