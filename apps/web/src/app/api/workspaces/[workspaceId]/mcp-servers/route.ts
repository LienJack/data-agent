import {
  buildMcpServerRevision,
  type McpServerRevision,
  mcpServerRevisionSchema,
  workspaceIdempotencyKeySchema,
} from "@data-agent/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deriveIdempotentOperationId } from "@/lib/run-command-identity";
import { getMcpRegistry } from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const mcpCommitInputSchema = z.strictObject({
  idempotency_key: workspaceIdempotencyKeySchema,
  expected_head_version: z.number().int().positive().safe().nullable(),
  target_lifecycle: z.enum(["ENABLED", "DISABLED", "REVOKED"]),
  revision: z.strictObject({
    schema_version: mcpServerRevisionSchema.shape.schema_version,
    server_id: mcpServerRevisionSchema.shape.server_id,
    revision: mcpServerRevisionSchema.shape.revision,
    endpoint: mcpServerRevisionSchema.shape.endpoint,
    secret_ref_id: mcpServerRevisionSchema.shape.secret_ref_id,
    trust_class: mcpServerRevisionSchema.shape.trust_class,
    approval_status: mcpServerRevisionSchema.shape.approval_status,
    audience: mcpServerRevisionSchema.shape.audience,
    manifest_version: mcpServerRevisionSchema.shape.manifest_version,
    tools: mcpServerRevisionSchema.shape.tools,
    policy_revision: mcpServerRevisionSchema.shape.policy_revision,
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
      code: "MCP_SERVER_LIST_INPUT_INVALID",
      message: "enabled_only 只能为 true 或 false。",
      retryable: false,
    });
  }
  const result = await getMcpRegistry().list(authorized.value.capability, selection);
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
      message: "仅工作空间管理员可以变更 MCP Server。",
      retryable: false,
    });
  }
  const parsed = mcpCommitInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return workspaceErrorResponse({
      code: "MCP_SERVER_INPUT_INVALID",
      message: "MCP Server Revision 不符合严格合同。",
      retryable: false,
    });
  }
  const operationId = deriveIdempotentOperationId({
    operation_kind: "mcp-server-commit",
    workspace_id: workspaceId,
    principal_id: authorized.value.capability.principal,
    idempotency_key: parsed.data.idempotency_key,
  });
  let revision: McpServerRevision;
  try {
    revision = await buildMcpServerRevision({
      ...parsed.data.revision,
      scope: authorized.value.capability.scope,
    });
  } catch {
    return workspaceErrorResponse({
      code: "MCP_SERVER_INPUT_INVALID",
      message: "MCP Server Revision 不符合严格合同。",
      retryable: false,
    });
  }
  const result = await getMcpRegistry().commit(authorized.value.capability, {
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
