import { channel } from "node:diagnostics_channel";
import type { PortResult } from "@data-agent/contracts";
import type { Pool, QueryResultRow } from "pg";
import type { AppCapability } from "../tenancy/capability.js";
import {
  revalidateCapabilityInTransaction,
  type TransactionalCapabilityAuthorizer,
  usesTransactionalDatabaseAuthority,
} from "../tenancy/transactional-authority.internal.js";

export interface SqlQueryResult<Row extends object = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface SqlClient {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
  release(error?: Error): void;
}

export interface SqlPool {
  connect(): Promise<SqlClient>;
}

export interface AppTransactionContext {
  readonly capability: AppCapability;
  readonly client: SqlClient;
}

interface AppTransactionCommonOptions {
  readonly map_database_error?: (error: unknown) => PortResult<never> | null;
  readonly operation_name?: string;
  readonly correlation_id?: string;
}

export type AppTransactionOptions = AppTransactionCommonOptions &
  (
    | {
        readonly access: "READ";
        /** 只允许缩小既有 READ 角色集合，不能扩权到 DEMO。 */
        readonly allowed_roles?: readonly ("OWNER" | "ANALYST" | "VIEWER")[];
        /** 需要跨多条查询保持同一权威视图时，显式请求只读可重复读快照。 */
        readonly snapshot?: "REPEATABLE_READ";
      }
    | {
        readonly access: "WRITE";
        /** 只允许缩小既有 WRITE 角色集合，不能扩权到 VIEWER 或 DEMO。 */
        readonly allowed_roles?: readonly ("OWNER" | "ANALYST")[];
      }
  );

export const PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL =
  "data-agent.platform.persistence.transaction.failure";

export interface PersistenceTransactionDiagnostic {
  readonly operation_name: string;
  readonly correlation_id?: string;
  readonly error_class: string;
  readonly sqlstate?: string;
  readonly marker?: string;
}

const persistenceTransactionDiagnosticChannel = channel(PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL);

export class PersistenceBoundaryError extends Error {
  override readonly name = "PersistenceBoundaryError";

  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function transactionFailure(error: unknown, options: AppTransactionOptions): PortResult<never> {
  if (error instanceof PersistenceBoundaryError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }
  const mappedFailure = options.map_database_error?.(error);
  if (mappedFailure) return mappedFailure;

  const candidate =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown; readonly message?: unknown; readonly name?: unknown })
      : null;
  const diagnostic: PersistenceTransactionDiagnostic = {
    operation_name: options.operation_name?.match(/^[a-z][a-z0-9._:-]{0,127}$/)?.[0] ?? "unknown",
    ...(options.correlation_id?.match(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/)
      ? { correlation_id: options.correlation_id }
      : {}),
    error_class:
      typeof candidate?.name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(candidate.name)
        ? candidate.name
        : error instanceof Error
          ? "Error"
          : "UnknownError",
    ...(typeof candidate?.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)
      ? { sqlstate: candidate.code }
      : {}),
    ...(typeof candidate?.message === "string" &&
    /^DA_[A-Z][A-Z0-9_]{1,126}$/.test(candidate.message)
      ? { marker: candidate.message }
      : {}),
  };
  persistenceTransactionDiagnosticChannel.publish(diagnostic);

  return {
    ok: false,
    error: {
      code: "PERSISTENCE_TRANSACTION_FAILED",
      message: "持久化事务失败；数据库错误细节已从公开响应中移除。",
      retryable: true,
    },
  };
}

async function establishScope(
  client: SqlClient,
  capability: AppCapability,
  requireWrite: boolean,
): Promise<void> {
  await client.query("SET LOCAL search_path TO app_data_agent, pg_catalog");
  await client.query(
    `select
       pg_catalog.set_config('data_agent.app_id', $1, true),
       pg_catalog.set_config('data_agent.tenant_id', $2, true),
       pg_catalog.set_config('data_agent.environment', $3, true),
       pg_catalog.set_config('data_agent.principal_id', $4, true),
       pg_catalog.set_config('data_agent.role', $5, true),
       pg_catalog.set_config('data_agent.deployment_id', $6, true)`,
    [
      capability.scope.app_id,
      capability.scope.tenant_id,
      capability.scope.environment,
      capability.principal,
      capability.role.toLowerCase(),
      capability.deployment_id,
    ],
  );
  const confirmed = await client.query<{ readonly allowed: boolean }>(
    "select platform.backend_context_matches($1::uuid, $2::uuid, $3::text, $4::boolean) as allowed",
    [
      capability.scope.app_id,
      capability.scope.tenant_id,
      capability.scope.environment,
      requireWrite,
    ],
  );
  if (confirmed.rows[0]?.allowed !== true) {
    throw new PersistenceBoundaryError(
      "PERSISTENCE_SCOPE_REJECTED",
      "PostgreSQL RLS Authority 拒绝当前 App/Tenant/Environment Context。",
    );
  }
}

export async function withAppTransaction<T>(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
  capabilityInput: unknown,
  options: AppTransactionOptions,
  work: (context: AppTransactionContext) => Promise<T>,
): Promise<PortResult<T>> {
  if (!usesTransactionalDatabaseAuthority(authorizer)) {
    return {
      ok: false,
      error: {
        code: "PERSISTENCE_DATABASE_AUTHORITY_REQUIRED",
        message: "权威 PostgreSQL 操作必须使用可在同一事务内复核的 Database Authority。",
        retryable: false,
      },
    };
  }

  const allowedRoles =
    options.allowed_roles ??
    (options.access === "WRITE"
      ? (["OWNER", "ANALYST"] as const)
      : (["OWNER", "ANALYST", "VIEWER"] as const));
  const preflight = authorizer.requireRole(capabilityInput, allowedRoles, options.access);
  if (!preflight.ok) {
    return preflight.error.code === "APP_OPERATION_DENIED"
      ? {
          ok: false,
          error: {
            code: "PERSISTENCE_WRITE_DENIED",
            message: "当前 App Capability 不允许访问权威存储。",
            retryable: false,
          },
        }
      : preflight;
  }

  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return {
      ok: false,
      error: {
        code: "PERSISTENCE_UNAVAILABLE",
        message: "当前无法建立权威数据库连接。",
        retryable: true,
      },
    };
  }

  let transactionStarted = false;
  try {
    // Capability revalidation takes FOR SHARE locks, which PostgreSQL rejects in READ ONLY
    // transactions. REPEATABLE READ still provides the single authority/data snapshot.
    await client.query(
      options.access === "READ" && options.snapshot === "REPEATABLE_READ"
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ"
        : "BEGIN",
    );
    transactionStarted = true;
    const required = await revalidateCapabilityInTransaction(
      authorizer,
      capabilityInput,
      allowedRoles,
      options.access,
      client,
    );
    if (!required.ok) {
      throw new PersistenceBoundaryError(
        required.error.code,
        required.error.message,
        required.error.retryable,
      );
    }
    await establishScope(client, required.value, options.access === "WRITE");
    const value = await work({ capability: required.value, client });
    await client.query("COMMIT");
    return { ok: true, value };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original typed failure is more useful; the connection is discarded by release().
      }
    }
    return transactionFailure(error, options);
  } finally {
    client.release();
  }
}

export function adaptPgPool(pool: Pool): SqlPool {
  return {
    async connect(): Promise<SqlClient> {
      const client = await pool.connect();
      return {
        async query<Row extends object = Record<string, unknown>>(
          text: string,
          values: readonly unknown[] = [],
        ): Promise<SqlQueryResult<Row>> {
          const result = await client.query<QueryResultRow>(text, [...values]);
          return {
            rows: result.rows as Row[],
            rowCount: result.rowCount,
          };
        },
        release(error?: Error): void {
          client.release(error);
        },
      };
    },
  };
}
