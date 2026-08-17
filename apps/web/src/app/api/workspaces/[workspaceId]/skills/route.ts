import {
  buildSkillRevision,
  type SkillRevision,
  skillRevisionSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getSkillRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const skillCommitInputSchema = z.strictObject({
  idempotency_key: workspaceIdempotencyKeySchema,
  expected_head_version: z.number().int().positive().safe().nullable(),
  target_lifecycle: z.enum(["ENABLED", "DISABLED", "QUARANTINED", "REVOKED"]),
  revision: z.strictObject({
    schema_version: skillRevisionSchema.shape.schema_version,
    skill_id: skillRevisionSchema.shape.skill_id,
    revision: skillRevisionSchema.shape.revision,
    name: skillRevisionSchema.shape.name,
    source_url: skillRevisionSchema.shape.source_url,
    package_hash: skillRevisionSchema.shape.package_hash,
    dependency_lock_hash: skillRevisionSchema.shape.dependency_lock_hash,
    signer_id: skillRevisionSchema.shape.signer_id,
    signature_hash: skillRevisionSchema.shape.signature_hash,
    publisher_trust: skillRevisionSchema.shape.publisher_trust,
    approval_status: skillRevisionSchema.shape.approval_status,
    capabilities: skillRevisionSchema.shape.capabilities,
    default_resources: skillRevisionSchema.shape.default_resources,
    install_scripts: skillRevisionSchema.shape.install_scripts,
  }),
});

function enabledOnly(request: NextRequest): boolean | null {
  const value = request.nextUrl.searchParams.get("enabled_only");
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  return null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  const selection = enabledOnly(request);
  if (selection === null) {
    return workspaceErrorResponse({
      code: "SKILL_LIST_INPUT_INVALID",
      message: "enabled_only 只能为 true 或 false。",
      retryable: false,
    });
  }
  const result = await getSkillRegistry().list(authorized.value.capability, selection);
  return result.ok
    ? NextResponse.json({ data: result.value })
    : workspaceErrorResponse(result.error);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "WRITE");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);
  if (authorized.value.capability.role !== "OWNER") {
    return workspaceErrorResponse({
      code: "WORKSPACE_ROLE_DENIED",
      message: "仅工作空间管理员可以变更 Skill。",
      retryable: false,
    });
  }
  const parsed = skillCommitInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workspaceErrorResponse({
      code: "SKILL_INPUT_INVALID",
      message: "Skill Revision 不符合严格合同。",
      retryable: false,
    });
  }
  const operationId = deriveIdempotentOperationId({
    operation_kind: "skill-commit",
    workspace_id: workspaceId,
    principal_id: authorized.value.capability.principal,
    idempotency_key: parsed.data.idempotency_key,
  });
  let revision: SkillRevision;
  try {
    revision = await buildSkillRevision({
      ...parsed.data.revision,
      scope: authorized.value.capability.scope,
    });
  } catch {
    return workspaceErrorResponse({
      code: "SKILL_INPUT_INVALID",
      message: "Skill Revision 不符合严格合同。",
      retryable: false,
    });
  }
  const result = await getSkillRegistry().commit(authorized.value.capability, {
    operation_id: operationId,
    idempotency_key: parsed.data.idempotency_key,
    expected_head_version: parsed.data.expected_head_version,
    target_lifecycle: parsed.data.target_lifecycle,
    revision,
  });
  return result.ok
    ? NextResponse.json({ data: result.value }, { status: 201 })
    : workspaceErrorResponse(result.error);
}
