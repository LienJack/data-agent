import {
  agentProductProfileRevisionSchema,
  buildAgentProductProfileCommitCommand,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getAgentProfileRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ workspaceId: string }> };

const commitInputSchema = z.strictObject({
  idempotency_key: workspaceIdempotencyKeySchema,
  revision: agentProductProfileRevisionSchema,
  expected_head_version: z.number().int().nonnegative().safe(),
  target_lifecycle: z.enum(["ENABLED", "DISABLED", "QUARANTINED"]),
});

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const enabledOnly = request.nextUrl.searchParams.get("enabled_only") === "true";
  const result = await getAgentProfileRegistry().list(authorized.value.capability, enabledOnly);
  return result.ok
    ? NextResponse.json({
        data: {
          schema_version: "agent-product-profile-list-result@1.0.0",
          items: result.value,
        },
      })
    : workspaceErrorResponse(result.error);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = commitInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "AGENT_PROFILE_INPUT_INVALID",
      message: "Agent Profile input does not match the strict contract.",
      retryable: false,
    });
  }
  const operationId = deriveIdempotentOperationId({
    operation_kind: "agent-profile-commit",
    workspace_id: workspaceId,
    principal_id: authorized.value.capability.principal,
    idempotency_key: input.data.idempotency_key,
  });
  const command = await buildAgentProductProfileCommitCommand({
    schema_version: "agent-product-profile-commit-command@1.0.0",
    operation_id: operationId,
    idempotency_key: input.data.idempotency_key,
    actor_principal_id: authorized.value.capability.principal,
    revision: input.data.revision,
    expected_head_version: input.data.expected_head_version,
    target_lifecycle: input.data.target_lifecycle,
  });
  const result = await getAgentProfileRegistry().commit(authorized.value.capability, command);
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 201 })
    : workspaceErrorResponse(result.error);
}
