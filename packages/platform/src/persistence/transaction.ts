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
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlClient>;
}

export interface AppTransactionContext {
  readonly capability: AppCapability;
  readonly client: SqlClient;
}

export interface AppTransactionOptions {
  readonly access: "READ" | "WRITE";
}

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

function transactionFailure(error: unknown): PortResult<never> {
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

  const preflight = authorizer.requireRole(
    capabilityInput,
    options.access === "WRITE" ? ["OWNER", "ANALYST"] : ["OWNER", "ANALYST", "VIEWER"],
    options.access,
  );
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
    await client.query("BEGIN");
    transactionStarted = true;
    const allowedRoles =
      options.access === "WRITE"
        ? (["OWNER", "ANALYST"] as const)
        : (["OWNER", "ANALYST", "VIEWER"] as const);
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
    return transactionFailure(error);
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
        release(): void {
          client.release();
        },
      };
    },
  };
}
