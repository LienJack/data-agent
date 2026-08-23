import type { NextRequest } from "next/server";
import { handleGetSemanticBindingImpact } from "@/lib/semantic-binding-impact-route";
import { getWorkspaceSemanticRuntime } from "@/lib/workspace-semantic-runtime";

export const dynamic = "force-dynamic";

type RouteContext = {
  readonly params: Promise<{ workspaceId: string; impactId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId, impactId } = await context.params;
  const resolved = await getWorkspaceSemanticRuntime(request, {
    feature: "BINDING_IMPACT",
    access: "READ",
    workspaceId,
  });
  return resolved.ok
    ? handleGetSemanticBindingImpact(request, Promise.resolve({ impactId }), resolved.runtime)
    : resolved.response;
}
