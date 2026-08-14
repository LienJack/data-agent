import {
  type AdminUserProjection,
  adminUserProjectionSchema,
  type AdminWorkspaceMemberProjection,
  adminWorkspaceMemberProjectionSchema,
  type AdminWorkspaceProjection,
  adminWorkspaceProjectionSchema,
  type OperationsHealthProjection,
  operationsHealthProjectionSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type { SqlClient, SqlPool } from "../persistence/transaction.js";
import { failure, type BoundaryResult } from "./capability.js";

const operationsAdminContextSchema = z.strictObject({
  deployment_id: z.uuid(),
  principal_id: z.uuid(),
});

const workspaceMembersContextSchema = operationsAdminContextSchema.extend({
  workspace_id: z.uuid(),
});

export type OperationsAdminContext = z.infer<typeof operationsAdminContextSchema>;
export type WorkspaceMembersContext = z.infer<typeof workspaceMembersContextSchema>;

interface ProjectionRow {
  readonly projection: unknown;
}

interface HealthRow {
  readonly health: unknown;
}

function isDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["42501", "P0002"].includes(String(error.code))
  );
}

async function withClient<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<BoundaryResult<T>> {
  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return failure("OPERATIONS_ADMIN_UNAVAILABLE", "管理控制面暂时不可用。", true);
  }
  try {
    return { ok: true, value: await operation(client) };
  } catch (error) {
    return isDenied(error)
      ? failure("OPERATIONS_ADMIN_ACCESS_DENIED", "当前角色无权访问管理控制面。")
      : failure("OPERATIONS_ADMIN_READ_FAILED", "管理控制面读取失败。", true);
  } finally {
    client.release();
  }
}

function adminContext(input: unknown): BoundaryResult<OperationsAdminContext> {
  const parsed = operationsAdminContextSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure("OPERATIONS_ADMIN_CONTEXT_INVALID", "管理上下文不符合严格契约。");
}

function membersContext(input: unknown): BoundaryResult<WorkspaceMembersContext> {
  const parsed = workspaceMembersContextSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure("WORKSPACE_MEMBERS_CONTEXT_INVALID", "成员管理上下文不符合严格契约。");
}

function projections<T>(
  rows: readonly ProjectionRow[],
  schema: z.ZodType<T>,
): readonly T[] {
  return Object.freeze(rows.map((row) => schema.parse(row.projection)));
}

export function createPostgresOperationsAdminRepository(pool: SqlPool) {
  return Object.freeze({
    async listUsers(input: unknown): Promise<BoundaryResult<readonly AdminUserProjection[]>> {
      const parsed = adminContext(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ProjectionRow>(
          "select * from platform.list_admin_users($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return projections(result.rows, adminUserProjectionSchema);
      });
    },

    async listWorkspaces(
      input: unknown,
    ): Promise<BoundaryResult<readonly AdminWorkspaceProjection[]>> {
      const parsed = adminContext(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ProjectionRow>(
          "select * from platform.list_admin_workspaces($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return projections(result.rows, adminWorkspaceProjectionSchema);
      });
    },

    async listWorkspaceMembers(
      input: unknown,
    ): Promise<BoundaryResult<readonly AdminWorkspaceMemberProjection[]>> {
      const parsed = membersContext(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ProjectionRow>(
          "select * from platform.list_workspace_members($1::uuid,$2::uuid,$3::uuid)",
          [
            parsed.value.deployment_id,
            parsed.value.principal_id,
            parsed.value.workspace_id,
          ],
        );
        return projections(result.rows, adminWorkspaceMemberProjectionSchema);
      });
    },

    async readHealth(input: unknown): Promise<BoundaryResult<OperationsHealthProjection>> {
      const parsed = adminContext(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<HealthRow>(
          "select platform.read_operations_health($1::uuid,$2::uuid) as health",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        const row = result.rows[0];
        if (!row) throw new Error("OPERATIONS_HEALTH_MISSING");
        return operationsHealthProjectionSchema.parse(row.health);
      });
    },
  });
}

export type PostgresOperationsAdminRepository = ReturnType<
  typeof createPostgresOperationsAdminRepository
>;
