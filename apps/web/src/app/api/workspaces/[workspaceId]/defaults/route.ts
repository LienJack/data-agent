import {
  buildWorkspaceDefaultsCasUpdateCommandCandidate,
  workspaceDefaultsSelectionCandidateSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getEffectiveConfigResolver } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const defaultsPatchInputSchema = z.strictObject({
  expected_revision: z.number().int().nonnegative().safe(),
  idempotency_key: workspaceIdempotencyKeySchema,
  defaults: workspaceDefaultsSelectionCandidateSchema,
});

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const result = await getEffectiveConfigResolver().getWorkspaceDefaults(
    authorized.value.capability,
  );
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const input = defaultsPatchInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return workspaceErrorResponse({
      code: "WORKSPACE_DEFAULTS_INPUT_INVALID",
      message: "Defaults PATCH 不符合严格合同。",
      retryable: false,
    });
  }
  const command = await buildWorkspaceDefaultsCasUpdateCommandCandidate({
    schema_version: "workspace-defaults-cas-update@1.0.0",
    operation_id: deriveIdempotentOperationId({
      operation_kind: "workspace-defaults-update",
      workspace_id: workspaceId,
      principal_id: authorized.value.capability.principal,
      idempotency_key: input.data.idempotency_key,
    }),
    workspace_id: workspaceId,
    expected_defaults_revision: input.data.expected_revision,
    idempotency_key: input.data.idempotency_key,
    defaults: input.data.defaults,
  });
  const result = await getEffectiveConfigResolver().updateWorkspaceDefaults(
    authorized.value.capability,
    command,
  );
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}
