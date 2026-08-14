import {
  actionsForWorkspaceRole,
  type IdentityOperationReceipt,
  identityCommandSchema,
  identityOperationReceiptSchema,
  type SystemRole,
  type WorkspaceAccessProjection,
  type WorkspaceRole,
  workspaceAccessProjectionSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type AppCapability,
  type AppCapabilityRole,
  type BoundaryResult,
  type CapabilityOperation,
  type CapabilityQueryClient,
  failure,
} from "./capability.js";
import type { AuthoritySqlPool } from "./postgres-authority.js";
import {
  revalidateInTransaction,
  type TransactionalCapabilityAuthorizer,
} from "./transactional-authority.internal.js";

const workspaceResolveInputSchema = z.strictObject({
  deployment_id: z.uuid(),
  workspace_id: z.uuid(),
  principal_id: z.uuid(),
  access: z.enum(["READ", "WRITE"]).default("READ"),
});

const sessionPrincipalInputSchema = z.strictObject({
  deployment_id: z.uuid(),
  auth_user_id: z.uuid(),
});

const workspaceListInputSchema = z.strictObject({
  deployment_id: z.uuid(),
  principal_id: z.uuid(),
});

const identityCommandInputSchema = z.strictObject({
  deployment_id: z.uuid(),
  actor_principal_id: z.uuid(),
  auth_user_id: z.uuid().nullable().default(null),
  command: identityCommandSchema,
});

const sideEffectCompletionInputSchema = z.strictObject({
  deployment_id: z.uuid(),
  actor_principal_id: z.uuid(),
  operation_id: z.uuid(),
  succeeded: z.boolean(),
  reason_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
});

interface WorkspaceAuthoritySqlClient extends CapabilityQueryClient {
  release(): void;
}

interface WorkspaceAuthorityRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly deployment_id: string;
  readonly principal_id: string;
  readonly capability_role: string;
  readonly workspace_role: WorkspaceRole;
  readonly system_role: SystemRole;
  readonly membership_version: string | number;
  readonly user_authz_epoch: string | number;
  readonly workspace_lifecycle_version: string | number;
  readonly app_epoch: string | number;
  readonly app_lifecycle_state: string;
  readonly workspace_lifecycle: string;
  readonly can_write: boolean;
}

interface SessionPrincipalRow {
  readonly app_id: string;
  readonly environment: string;
  readonly principal_id: string;
  readonly auth_user_id: string;
  readonly system_role: SystemRole;
  readonly authz_epoch: string | number;
}

interface WorkspaceListRow {
  readonly app_id: string;
  readonly environment: string;
  readonly workspace_id: string;
  readonly slug: string;
  readonly display_name: string;
  readonly lifecycle: "ACTIVE" | "ARCHIVED";
  readonly lifecycle_version: string | number;
  readonly created_at: Date | string;
  readonly archived_at: Date | string | null;
  readonly principal_id: string;
  readonly system_role: SystemRole;
  readonly workspace_role: WorkspaceRole;
  readonly membership_version: string | number;
}

interface WorkspaceCapabilityRecord {
  readonly capability: AppCapability;
  readonly capabilityRole: string;
  readonly workspaceRole: WorkspaceRole;
  readonly systemRole: SystemRole;
  readonly membershipVersion: string;
  readonly userAuthzEpoch: string;
  readonly workspaceLifecycleVersion: string;
  readonly appEpoch: string;
  readonly appLifecycleState: string;
  readonly workspaceLifecycle: string;
  readonly canWrite: boolean;
}

export type ResolvedSessionPrincipal = Readonly<{
  app_id: string;
  environment: string;
  principal_id: string;
  auth_user_id: string;
  system_role: SystemRole;
  authz_epoch: string;
}>;

function roleFromDatabase(value: string): AppCapabilityRole | null {
  switch (value) {
    case "owner":
      return "OWNER";
    case "analyst":
      return "ANALYST";
    case "viewer":
      return "VIEWER";
    default:
      return null;
  }
}

function exactAuthorityRow(record: WorkspaceCapabilityRecord, row: WorkspaceAuthorityRow): boolean {
  const capability = record.capability;
  return (
    row.app_id === capability.scope.app_id &&
    row.tenant_id === capability.scope.tenant_id &&
    row.environment === capability.scope.environment &&
    row.deployment_id === capability.deployment_id &&
    row.principal_id === capability.principal &&
    row.capability_role === record.capabilityRole &&
    row.workspace_role === record.workspaceRole &&
    row.system_role === record.systemRole &&
    String(row.membership_version) === record.membershipVersion &&
    String(row.user_authz_epoch) === record.userAuthzEpoch &&
    String(row.workspace_lifecycle_version) === record.workspaceLifecycleVersion &&
    String(row.app_epoch) === record.appEpoch
  );
}

function unavailable<T>(): BoundaryResult<T> {
  return failure(
    "APP_AUTHORITY_UNAVAILABLE",
    "PostgreSQL 无法确认当前工作空间权限；数据库细节已移除。",
    true,
  );
}

function isAuthorityDenial(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["40001", "42501", "P0002"].includes(String(error.code))
  );
}

async function withClient<T>(
  pool: AuthoritySqlPool,
  operation: (client: WorkspaceAuthoritySqlClient) => Promise<BoundaryResult<T>>,
): Promise<BoundaryResult<T>> {
  let client: WorkspaceAuthoritySqlClient;
  try {
    client = (await pool.connect()) as WorkspaceAuthoritySqlClient;
  } catch {
    return unavailable();
  }
  try {
    return await operation(client);
  } catch (error) {
    return isAuthorityDenial(error)
      ? failure("WORKSPACE_ACCESS_DENIED", "当前用户不能访问该工作空间。")
      : unavailable();
  } finally {
    client.release();
  }
}

export function createPostgresWorkspaceAuthority(pool: AuthoritySqlPool) {
  const records = new WeakMap<object, WorkspaceCapabilityRecord>();

  const local = (
    value: unknown,
    allowedRoles: readonly AppCapabilityRole[],
    operation: CapabilityOperation = "READ",
  ): BoundaryResult<AppCapability> => {
    if (typeof value !== "object" || value === null) {
      return failure("APP_CAPABILITY_REQUIRED", "操作必须使用服务端签发的 AppCapability。");
    }
    const record = records.get(value);
    if (!record) {
      return failure(
        "APP_CAPABILITY_ISSUER_MISMATCH",
        "App Capability 不是由当前 Workspace Authority 签发。",
      );
    }
    if (!allowedRoles.includes(record.capability.role)) {
      return failure("WORKSPACE_ROLE_DENIED", "当前工作空间角色无权执行该操作。");
    }
    if (
      operation !== "READ" &&
      (record.appLifecycleState !== "ACTIVE" ||
        record.workspaceLifecycle !== "ACTIVE" ||
        !record.canWrite)
    ) {
      return failure("WORKSPACE_ARCHIVED", "工作空间当前不可写入。");
    }
    return { ok: true, value: record.capability };
  };

  async function queryRevalidation(
    client: CapabilityQueryClient,
    record: WorkspaceCapabilityRecord,
    operation: CapabilityOperation,
  ): Promise<BoundaryResult<AppCapability>> {
    try {
      const capability = record.capability;
      const result = await client.query<WorkspaceAuthorityRow>(
        `select *
         from platform.revalidate_workspace_authority(
           $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid,
           $6::text, $7::text, $8::text, $9::bigint, $10::bigint,
           $11::bigint, $12::bigint, $13::boolean
         )`,
        [
          capability.scope.app_id,
          capability.scope.tenant_id,
          capability.scope.environment,
          capability.deployment_id,
          capability.principal,
          record.capabilityRole,
          record.workspaceRole,
          record.systemRole,
          record.membershipVersion,
          record.userAuthzEpoch,
          record.workspaceLifecycleVersion,
          record.appEpoch,
          operation !== "READ",
        ],
      );
      const row = result.rows[0];
      if (
        result.rowCount !== 1 ||
        !row ||
        !exactAuthorityRow(record, row) ||
        (operation !== "READ" && !row.can_write)
      ) {
        return failure("WORKSPACE_ACCESS_DENIED", "当前用户不能访问该工作空间。");
      }
      return { ok: true, value: capability };
    } catch (error) {
      return isAuthorityDenial(error)
        ? failure("WORKSPACE_ACCESS_DENIED", "当前用户不能访问该工作空间。")
        : unavailable();
    }
  }

  const authorizer: TransactionalCapabilityAuthorizer = Object.freeze({
    verify(value: unknown): BoundaryResult<AppCapability> {
      return local(value, ["OWNER", "ANALYST", "VIEWER"], "READ");
    },
    requireRole(
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation = "READ",
    ): BoundaryResult<AppCapability> {
      return local(value, allowedRoles, operation);
    },
    async revalidate(
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation = "READ",
    ): Promise<BoundaryResult<AppCapability>> {
      const checked = local(value, allowedRoles, operation);
      if (!checked.ok) return checked;
      const record = records.get(checked.value);
      if (!record) return failure("APP_CAPABILITY_REQUIRED", "缺少工作空间 Capability。");
      return withClient(pool, (client) => queryRevalidation(client, record, operation));
    },
    async [revalidateInTransaction](
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation,
      client: CapabilityQueryClient,
    ): Promise<BoundaryResult<AppCapability>> {
      const checked = local(value, allowedRoles, operation);
      if (!checked.ok) return checked;
      const record = records.get(checked.value);
      return record
        ? queryRevalidation(client, record, operation)
        : failure("APP_CAPABILITY_REQUIRED", "缺少工作空间 Capability。");
    },
  });

  return Object.freeze({
    authorizer,
    async resolveForServerContext(input: unknown): Promise<BoundaryResult<AppCapability>> {
      const parsed = workspaceResolveInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("APP_AUTHORITY_INPUT_INVALID", "服务端工作空间 Context 不符合契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<WorkspaceAuthorityRow>(
          `select * from platform.resolve_workspace_authority($1::uuid,$2::uuid,$3::uuid,$4::boolean)`,
          [
            parsed.data.deployment_id,
            parsed.data.workspace_id,
            parsed.data.principal_id,
            parsed.data.access === "WRITE",
          ],
        );
        const row = result.rows[0];
        const role = row ? roleFromDatabase(row.capability_role) : null;
        if (
          result.rowCount !== 1 ||
          !row ||
          !role ||
          row.deployment_id !== parsed.data.deployment_id ||
          row.tenant_id !== parsed.data.workspace_id ||
          row.principal_id !== parsed.data.principal_id
        ) {
          return failure("WORKSPACE_ACCESS_DENIED", "当前用户不能访问该工作空间。");
        }
        const capability: AppCapability = Object.freeze({
          scope: Object.freeze({
            app_id: row.app_id,
            tenant_id: row.tenant_id,
            environment: row.environment,
          }),
          deployment_id: row.deployment_id,
          principal: row.principal_id,
          role,
        });
        records.set(capability, {
          capability,
          capabilityRole: row.capability_role,
          workspaceRole: row.workspace_role,
          systemRole: row.system_role,
          membershipVersion: String(row.membership_version),
          userAuthzEpoch: String(row.user_authz_epoch),
          workspaceLifecycleVersion: String(row.workspace_lifecycle_version),
          appEpoch: String(row.app_epoch),
          appLifecycleState: row.app_lifecycle_state,
          workspaceLifecycle: row.workspace_lifecycle,
          canWrite: row.can_write,
        });
        return { ok: true, value: capability };
      });
    },

    async resolveSessionPrincipal(
      input: unknown,
    ): Promise<BoundaryResult<ResolvedSessionPrincipal>> {
      const parsed = sessionPrincipalInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("AUTH_SESSION_INVALID", "认证会话无法映射为应用用户。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<SessionPrincipalRow>(
          `select * from platform.resolve_session_principal($1::uuid,$2::uuid)`,
          [parsed.data.deployment_id, parsed.data.auth_user_id],
        );
        const row = result.rows[0];
        if (result.rowCount !== 1 || !row || row.auth_user_id !== parsed.data.auth_user_id) {
          return failure("AUTH_SESSION_INVALID", "认证会话无法映射为应用用户。");
        }
        return {
          ok: true,
          value: Object.freeze({
            app_id: row.app_id,
            environment: row.environment,
            principal_id: row.principal_id,
            auth_user_id: row.auth_user_id,
            system_role: row.system_role,
            authz_epoch: String(row.authz_epoch),
          }),
        };
      });
    },

    async listWorkspaces(
      input: unknown,
    ): Promise<BoundaryResult<readonly WorkspaceAccessProjection[]>> {
      const parsed = workspaceListInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("AUTH_SESSION_INVALID", "应用用户 Context 不符合契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<WorkspaceListRow>(
          `select * from platform.list_principal_workspaces($1::uuid,$2::uuid)`,
          [parsed.data.deployment_id, parsed.data.principal_id],
        );
        const projections = result.rows.map((row) =>
          workspaceAccessProjectionSchema.parse({
            schema_version: "workspace-access@1.0.0",
            workspace: {
              schema_version: "workspace@1.0.0",
              app_id: row.app_id,
              environment: row.environment,
              workspace_id: row.workspace_id,
              slug: row.slug,
              display_name: row.display_name,
              lifecycle: row.lifecycle,
              lifecycle_version: Number(row.lifecycle_version),
              created_at: new Date(row.created_at).toISOString(),
              archived_at:
                row.archived_at === null ? null : new Date(row.archived_at).toISOString(),
            },
            principal_id: row.principal_id,
            system_role: row.system_role,
            role: row.workspace_role,
            allowed_actions: [...actionsForWorkspaceRole(row.workspace_role, row.system_role)],
          }),
        );
        return { ok: true, value: Object.freeze(projections) };
      });
    },

    async applyIdentityCommand(input: unknown): Promise<BoundaryResult<IdentityOperationReceipt>> {
      const parsed = identityCommandInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("IDENTITY_COMMAND_INVALID", "身份管理命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly receipt: unknown }>(
          `select app_data_agent.apply_identity_command($1::uuid,$2::uuid,$3::uuid,$4::jsonb) as receipt`,
          [
            parsed.data.deployment_id,
            parsed.data.actor_principal_id,
            parsed.data.auth_user_id,
            parsed.data.command,
          ],
        );
        const row = result.rows[0];
        if (result.rowCount !== 1 || !row) return unavailable();
        const receipt = identityOperationReceiptSchema.safeParse(row.receipt);
        return receipt.success
          ? { ok: true, value: receipt.data }
          : failure("IDENTITY_OPERATION_RETRY_REQUIRED", "身份操作回执无法验证。", true);
      });
    },

    async completeIdentitySideEffect(
      input: unknown,
    ): Promise<BoundaryResult<IdentityOperationReceipt>> {
      const parsed = sideEffectCompletionInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("IDENTITY_COMMAND_INVALID", "身份副作用完成请求不符合契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly receipt: unknown }>(
          `select app_data_agent.complete_identity_side_effect($1::uuid,$2::uuid,$3::uuid,$4::boolean,$5::text) as receipt`,
          [
            parsed.data.deployment_id,
            parsed.data.actor_principal_id,
            parsed.data.operation_id,
            parsed.data.succeeded,
            parsed.data.reason_code,
          ],
        );
        const row = result.rows[0];
        if (result.rowCount !== 1 || !row) return unavailable();
        const receipt = identityOperationReceiptSchema.safeParse(row.receipt);
        return receipt.success
          ? { ok: true, value: receipt.data }
          : failure("IDENTITY_OPERATION_RETRY_REQUIRED", "身份操作回执无法验证。", true);
      });
    },
  });
}
