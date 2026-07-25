import { z } from "zod";
import {
  type AppCapability,
  type AppCapabilityRole,
  type BoundaryResult,
  type CapabilityOperation,
  type CapabilityQueryClient,
  failure,
} from "./capability.js";
import {
  revalidateInTransaction,
  type TransactionalCapabilityAuthorizer,
} from "./transactional-authority.internal.js";

const resolveInputSchema = z.strictObject({
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
  access: z.enum(["READ", "WRITE"]).default("READ"),
});

interface AuthoritySqlClient extends CapabilityQueryClient {
  release(): void;
}

export interface AuthoritySqlPool {
  connect(): Promise<AuthoritySqlClient>;
}

interface AuthorityRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly deployment_id: string;
  readonly principal_id: string;
  readonly membership_role: string;
  readonly membership_version: string | number;
  readonly app_epoch: string | number;
  readonly lifecycle_state: string;
  readonly can_write: boolean;
}

interface PostgresCapabilityRecord {
  readonly capability: AppCapability;
  readonly membershipRole: string;
  readonly membershipVersion: string;
  readonly appEpoch: string;
  readonly lifecycleState: string;
  readonly canWrite: boolean;
}

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

function exactRow(record: PostgresCapabilityRecord, row: AuthorityRow): boolean {
  const capability = record.capability;
  return (
    row.app_id === capability.scope.app_id &&
    row.tenant_id === capability.scope.tenant_id &&
    row.environment === capability.scope.environment &&
    row.deployment_id === capability.deployment_id &&
    row.principal_id === capability.principal &&
    row.membership_role === record.membershipRole &&
    String(row.membership_version) === record.membershipVersion &&
    String(row.app_epoch) === record.appEpoch
  );
}

function databaseAuthorityFailure<T>(): BoundaryResult<T> {
  return {
    ok: false,
    error: {
      code: "APP_AUTHORITY_UNAVAILABLE",
      message: "PostgreSQL Authority 无法确认当前 App Capability；数据库细节已移除。",
      retryable: true,
    },
  };
}

function isAuthorityDenial(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["40001", "42501", "P0002"].includes(String(error.code))
  );
}

export function createPostgresCapabilityAuthority(pool: AuthoritySqlPool) {
  const records = new WeakMap<object, PostgresCapabilityRecord>();

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
        "App Capability 不是由当前 PostgreSQL Authority 签发。",
      );
    }
    if (!allowedRoles.includes(record.capability.role)) {
      return failure("APP_OPERATION_DENIED", "当前 App Capability 无权执行该操作。");
    }
    if (operation !== "READ" && (record.lifecycleState !== "ACTIVE" || !record.canWrite)) {
      return failure("APP_OPERATION_FROZEN", "App 已冻结，不能执行新的写入或外连操作。");
    }
    return { ok: true, value: record.capability };
  };

  async function queryWithClient(
    client: CapabilityQueryClient,
    record: PostgresCapabilityRecord,
    operation: CapabilityOperation,
  ): Promise<BoundaryResult<AppCapability>> {
    try {
      const capability = record.capability;
      const result = await client.query<AuthorityRow>(
        `select *
         from platform.revalidate_backend_authority(
           $1::uuid,
           $2::uuid,
           $3::text,
           $4::uuid,
           $5::uuid,
           $6::text,
           $7::bigint,
           $8::bigint,
           $9::boolean
         )`,
        [
          capability.scope.app_id,
          capability.scope.tenant_id,
          capability.scope.environment,
          capability.deployment_id,
          capability.principal,
          record.membershipRole,
          record.membershipVersion,
          record.appEpoch,
          operation !== "READ",
        ],
      );
      const row = result.rows[0];
      if (
        result.rowCount !== 1 ||
        !row ||
        !exactRow(record, row) ||
        (operation !== "READ" && (!row.can_write || row.lifecycle_state !== "ACTIVE"))
      ) {
        return failure(
          "APP_AUTHORITY_STALE_OR_FORBIDDEN",
          "App Capability 已过期、撤销或不再具备当前操作权限。",
        );
      }
      return { ok: true, value: capability };
    } catch (error) {
      return isAuthorityDenial(error)
        ? failure(
            "APP_AUTHORITY_STALE_OR_FORBIDDEN",
            "App Capability 已过期、撤销或不再具备当前操作权限。",
          )
        : databaseAuthorityFailure();
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
      if (!record) {
        return failure("APP_CAPABILITY_REQUIRED", "操作必须使用服务端签发的 AppCapability。");
      }
      let client: AuthoritySqlClient;
      try {
        client = await pool.connect();
      } catch {
        return databaseAuthorityFailure();
      }
      try {
        return await queryWithClient(client, record, operation);
      } finally {
        client.release();
      }
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
        ? queryWithClient(client, record, operation)
        : failure("APP_CAPABILITY_REQUIRED", "操作必须使用服务端签发的 AppCapability。");
    },
  });

  return Object.freeze({
    authorizer,
    async resolveForServerContext(input: unknown): Promise<BoundaryResult<AppCapability>> {
      const parsed = resolveInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure(
          "APP_AUTHORITY_INPUT_INVALID",
          "服务端 Deployment/Tenant/Principal Context 不符合 UUID 契约。",
        );
      }

      let client: AuthoritySqlClient;
      try {
        client = await pool.connect();
      } catch {
        return databaseAuthorityFailure();
      }
      try {
        const result = await client.query<AuthorityRow>(
          `select *
           from platform.resolve_backend_authority(
             $1::uuid,
             $2::uuid,
             $3::uuid,
             $4::boolean
           )`,
          [
            parsed.data.deployment_id,
            parsed.data.tenant_id,
            parsed.data.principal_id,
            parsed.data.access === "WRITE",
          ],
        );
        const row = result.rows[0];
        const role = row ? roleFromDatabase(row.membership_role) : null;
        if (
          result.rowCount !== 1 ||
          !row ||
          !role ||
          row.deployment_id !== parsed.data.deployment_id ||
          row.tenant_id !== parsed.data.tenant_id ||
          row.principal_id !== parsed.data.principal_id
        ) {
          return failure("APP_SCOPE_FORBIDDEN", "服务端 Context 没有可用的 App Membership。");
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
          membershipRole: row.membership_role,
          membershipVersion: String(row.membership_version),
          appEpoch: String(row.app_epoch),
          lifecycleState: row.lifecycle_state,
          canWrite: row.can_write,
        });
        return { ok: true, value: capability };
      } catch (error) {
        return isAuthorityDenial(error)
          ? failure("APP_SCOPE_FORBIDDEN", "服务端 Context 没有可用的 App Membership。")
          : databaseAuthorityFailure();
      } finally {
        client.release();
      }
    },
  });
}
