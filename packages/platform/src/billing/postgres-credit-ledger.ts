import {
  type BillingAuditEntry,
  billingAuditEntrySchema,
  type CreditAccount,
  type CreditAdjustmentReceipt,
  type CreditHoldMutationReceipt,
  type CreditLedgerEntry,
  type CreditProjectionRebuildReceipt,
  type CreditReconciliationReceipt,
  creditAccountSchema,
  creditAdjustmentInputSchema,
  creditAdjustmentReceiptSchema,
  creditHoldMutationReceiptSchema,
  creditHoldReleaseInputSchema,
  creditHoldReservationInputSchema,
  creditLedgerEntrySchema,
  creditProjectionRebuildInputSchema,
  creditProjectionRebuildReceiptSchema,
  creditReconciliationReceiptSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type { SqlClient, SqlPool } from "../persistence/transaction.js";
import { type BoundaryResult, failure } from "../tenancy/capability.js";

const creditContextSchema = z.strictObject({
  deployment_id: z.uuid(),
  principal_id: z.uuid(),
});

const optionalTargetSchema = z.strictObject({
  target_principal_id: z.uuid().nullable().default(null),
});

interface CreditAccountRow {
  readonly app_id: string;
  readonly environment: string;
  readonly principal_id: string;
  readonly settled_microcredits: bigint | number | string;
  readonly active_held_microcredits: bigint | number | string;
  readonly available_microcredits: bigint | number | string;
  readonly version: bigint | number | string;
  readonly updated_at: Date | string;
}

interface CreditLedgerRow {
  readonly entry_id: string;
  readonly app_id: string;
  readonly environment: string;
  readonly principal_id: string;
  readonly workspace_id: string | null;
  readonly kind: CreditLedgerEntry["kind"];
  readonly signed_microcredits: bigint | number | string;
  readonly actor_principal_id: string;
  readonly reason: string;
  readonly idempotency_key: string;
  readonly balance_before_microcredits: bigint | number | string;
  readonly balance_after_microcredits: bigint | number | string;
  readonly account_version: bigint | number | string;
  readonly created_at: Date | string;
}

interface BillingAuditRow {
  readonly app_id: string;
  readonly environment: string;
  readonly audit_id: bigint | number | string;
  readonly operation_id: string;
  readonly actor_principal_id: string;
  readonly target_principal_id: string;
  readonly action: BillingAuditEntry["action"];
  readonly reason: string;
  readonly details: unknown;
  readonly created_at: Date | string;
}

export type CreditRepositoryContext = z.infer<typeof creditContextSchema>;

function integer(value: bigint | number | string): string {
  return String(value);
}

function safeVersion(value: bigint | number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("CREDIT_ACCOUNT_VERSION_INVALID");
  return parsed;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function account(row: CreditAccountRow): CreditAccount {
  return creditAccountSchema.parse({
    schema_version: "credit-account@1.0.0",
    app_id: row.app_id,
    environment: row.environment,
    principal_id: row.principal_id,
    settled_microcredits: integer(row.settled_microcredits),
    active_held_microcredits: integer(row.active_held_microcredits),
    available_microcredits: integer(row.available_microcredits),
    version: safeVersion(row.version),
    updated_at: timestamp(row.updated_at),
  });
}

function ledgerEntry(row: CreditLedgerRow): CreditLedgerEntry {
  return creditLedgerEntrySchema.parse({
    schema_version: "credit-ledger-entry@1.0.0",
    entry_id: row.entry_id,
    app_id: row.app_id,
    environment: row.environment,
    principal_id: row.principal_id,
    workspace_id: row.workspace_id,
    kind: row.kind,
    signed_microcredits: integer(row.signed_microcredits),
    actor_principal_id: row.actor_principal_id,
    reason: row.reason,
    idempotency_key: row.idempotency_key,
    balance_before_microcredits: integer(row.balance_before_microcredits),
    balance_after_microcredits: integer(row.balance_after_microcredits),
    account_version: safeVersion(row.account_version),
    created_at: timestamp(row.created_at),
  });
}

function auditEntry(row: BillingAuditRow): BillingAuditEntry {
  return billingAuditEntrySchema.parse({
    schema_version: "billing-audit-entry@1.0.0",
    app_id: row.app_id,
    environment: row.environment,
    audit_id: integer(row.audit_id),
    operation_id: row.operation_id,
    actor_principal_id: row.actor_principal_id,
    target_principal_id: row.target_principal_id,
    action: row.action,
    reason: row.reason,
    details: row.details,
    created_at: timestamp(row.created_at),
  });
}

function databaseError(error: unknown): BoundaryResult<never> {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "42501" || code === "P0002") {
    return message.includes("SUPER_ADMIN_REQUIRED")
      ? failure("SUPER_ADMIN_REQUIRED", "只有超级管理员可以访问全局积分管理。")
      : failure("CREDIT_ACCOUNT_ACCESS_DENIED", "无权访问该积分账户。");
  }
  if (code === "40001") {
    return failure("CREDIT_ACCOUNT_VERSION_CONFLICT", "积分账户已更新，请刷新后重试。");
  }
  if (code === "23505") {
    return failure("BILLING_OPERATION_CONFLICT", "同一幂等键已用于不同账务请求。");
  }
  if (code === "23514") {
    return failure("CREDIT_AVAILABLE_INSUFFICIENT", "可用积分不足，操作未执行。");
  }
  if (code === "55000") {
    return failure("CREDIT_HOLD_NOT_ACTIVE", "积分冻结已结束，不能重复释放。");
  }
  return failure("CREDIT_LEDGER_OPERATION_FAILED", "积分账务操作失败。", true);
}

async function withClient<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<BoundaryResult<T>> {
  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return failure("CREDIT_LEDGER_UNAVAILABLE", "积分账务暂时不可用。", true);
  }
  try {
    return { ok: true, value: await operation(client) };
  } catch (error) {
    return databaseError(error);
  } finally {
    client.release();
  }
}

function firstResult<Row>(rows: readonly { readonly result: Row }[]): Row {
  const row = rows[0];
  if (!row) throw new Error("CREDIT_LEDGER_RECEIPT_MISSING");
  return row.result;
}

export function createPostgresCreditLedgerRepository(pool: SqlPool) {
  function context(input: unknown): BoundaryResult<CreditRepositoryContext> {
    const parsed = creditContextSchema.safeParse(input);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : failure("CREDIT_CONTEXT_INVALID", "积分账户 Context 不符合严格契约。");
  }

  return Object.freeze({
    async getOwnAccount(input: unknown): Promise<BoundaryResult<CreditAccount>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<CreditAccountRow>(
          "select * from platform.get_own_credit_account($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        const row = result.rows[0];
        if (!row) throw Object.assign(new Error("CREDIT_ACCOUNT_ACCESS_DENIED"), { code: "42501" });
        return account(row);
      });
    },

    async listOwnLedger(input: unknown): Promise<BoundaryResult<readonly CreditLedgerEntry[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<CreditLedgerRow>(
          "select * from platform.list_own_credit_ledger($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(ledgerEntry));
      });
    },

    async listAccounts(input: unknown): Promise<BoundaryResult<readonly CreditAccount[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<CreditAccountRow>(
          "select * from platform.list_credit_accounts($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(account));
      });
    },

    async listLedger(
      input: unknown,
      options: unknown = {},
    ): Promise<BoundaryResult<readonly CreditLedgerEntry[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      const target = optionalTargetSchema.safeParse(options);
      if (!target.success) {
        return failure("CREDIT_LEDGER_QUERY_INVALID", "积分流水查询不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<CreditLedgerRow>(
          "select * from platform.list_credit_ledger($1::uuid,$2::uuid,$3::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id, target.data.target_principal_id],
        );
        return Object.freeze(result.rows.map(ledgerEntry));
      });
    },

    async listAudit(input: unknown): Promise<BoundaryResult<readonly BillingAuditEntry[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<BillingAuditRow>(
          "select * from platform.list_billing_audit($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(auditEntry));
      });
    },

    async adjust(
      input: unknown,
      command: unknown,
    ): Promise<BoundaryResult<CreditAdjustmentReceipt>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      const adjustment = creditAdjustmentInputSchema.safeParse(command);
      if (!adjustment.success) {
        return failure("CREDIT_ADJUSTMENT_INVALID", "积分调账命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select app_data_agent.apply_credit_adjustment($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsed.value.deployment_id, parsed.value.principal_id, adjustment.data],
        );
        return creditAdjustmentReceiptSchema.parse(firstResult(result.rows));
      });
    },

    async reserveHold(
      input: unknown,
      command: unknown,
    ): Promise<BoundaryResult<CreditHoldMutationReceipt>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      const reservation = creditHoldReservationInputSchema.safeParse(command);
      if (!reservation.success) {
        return failure("CREDIT_HOLD_RESERVATION_INVALID", "积分冻结命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select app_data_agent.reserve_credit_hold($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsed.value.deployment_id, parsed.value.principal_id, reservation.data],
        );
        return creditHoldMutationReceiptSchema.parse(firstResult(result.rows));
      });
    },

    async releaseHold(
      input: unknown,
      command: unknown,
    ): Promise<BoundaryResult<CreditHoldMutationReceipt>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      const release = creditHoldReleaseInputSchema.safeParse(command);
      if (!release.success) {
        return failure("CREDIT_HOLD_RELEASE_INVALID", "积分冻结释放命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select app_data_agent.release_credit_hold($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsed.value.deployment_id, parsed.value.principal_id, release.data],
        );
        return creditHoldMutationReceiptSchema.parse(firstResult(result.rows));
      });
    },

    async reconcile(
      input: unknown,
      targetPrincipalId?: unknown,
    ): Promise<BoundaryResult<CreditReconciliationReceipt>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      const target = z.uuid().safeParse(targetPrincipalId ?? parsed.value.principal_id);
      if (!target.success) {
        return failure("CREDIT_RECONCILIATION_INVALID", "积分对账目标不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select app_data_agent.reconcile_credit_account($1::uuid,$2::uuid,$3::uuid) as result",
          [parsed.value.deployment_id, parsed.value.principal_id, target.data],
        );
        return creditReconciliationReceiptSchema.parse(firstResult(result.rows));
      });
    },

    async rebuild(
      input: unknown,
      command: unknown,
    ): Promise<BoundaryResult<CreditProjectionRebuildReceipt>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      const rebuild = creditProjectionRebuildInputSchema.safeParse(command);
      if (!rebuild.success) {
        return failure("CREDIT_PROJECTION_REBUILD_INVALID", "积分投影重建命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select app_data_agent.rebuild_credit_account_projection($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsed.value.deployment_id, parsed.value.principal_id, rebuild.data],
        );
        return creditProjectionRebuildReceiptSchema.parse(firstResult(result.rows));
      });
    },
  });
}
