import { describe, expect, it } from "vitest";
import { createPostgresCreditLedgerRepository } from "../../src/billing/postgres-credit-ledger.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  deployment: "00000000-0000-4000-8000-00000000de01",
  principal: "00000000-0000-4000-8000-000000001001",
  target: "00000000-0000-4000-8000-000000001002",
  operation: "00000000-0000-4000-8000-00000000c401",
} as const;

function pool(handler: (text: string, values: readonly unknown[]) => SqlQueryResult): SqlPool {
  return {
    async connect() {
      return {
        async query<Row extends object>(text: string, values: readonly unknown[] = []) {
          return handler(text, values) as SqlQueryResult<Row>;
        },
        release() {},
      } satisfies SqlClient;
    },
  };
}

const account = {
  schema_version: "credit-account@1.0.0",
  app_id: ids.app,
  environment: "test",
  principal_id: ids.target,
  settled_microcredits: "100000000",
  active_held_microcredits: "25000000",
  available_microcredits: "75000000",
  version: 2,
  updated_at: "2026-08-14T00:00:00.000Z",
} as const;

const accountRow = {
  ...account,
  settled_microcredits: 100000000n,
  active_held_microcredits: 25000000n,
  available_microcredits: 75000000n,
  version: "2",
};

describe("PostgreSQL credit ledger repository", () => {
  it("returns the same database projection through independent repository instances", async () => {
    const first = createPostgresCreditLedgerRepository(
      pool(() => ({ rows: [accountRow], rowCount: 1 })),
    );
    const second = createPostgresCreditLedgerRepository(
      pool(() => ({ rows: [accountRow], rowCount: 1 })),
    );
    const context = { deployment_id: ids.deployment, principal_id: ids.target };
    await expect(first.getOwnAccount(context)).resolves.toMatchObject({ ok: true, value: account });
    await expect(second.getOwnAccount(context)).resolves.toMatchObject({
      ok: true,
      value: { available_microcredits: "75000000", version: 2 },
    });
  });

  it("passes only server context and the strict adjustment command to the RPC", async () => {
    let observed: readonly unknown[] = [];
    const repository = createPostgresCreditLedgerRepository(
      pool((_text, values) => {
        observed = values;
        return {
          rows: [{ result: { operation_id: ids.operation, account } }],
          rowCount: 1,
        };
      }),
    );
    const result = await repository.adjust(
      { deployment_id: ids.deployment, principal_id: ids.principal },
      {
        schema_version: "credit-adjustment@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "credit-adjustment-one",
        target_principal_id: ids.target,
        signed_microcredits: "100000000",
        reason: "initial allocation",
        expected_account_version: 1,
      },
    );
    expect(result.ok).toBe(true);
    expect(observed.slice(0, 2)).toEqual([ids.deployment, ids.principal]);
    expect(observed[2]).toMatchObject({ target_principal_id: ids.target });
    expect(JSON.stringify(observed)).not.toContain("system_role");
  });

  it("rejects caller-added identity and maps database denials to stable errors", async () => {
    const repository = createPostgresCreditLedgerRepository(
      pool(() => {
        throw Object.assign(new Error("SUPER_ADMIN_REQUIRED"), { code: "42501" });
      }),
    );
    await expect(
      repository.listAccounts({
        deployment_id: ids.deployment,
        principal_id: ids.principal,
        system_role: "SUPER_ADMIN",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "CREDIT_CONTEXT_INVALID" } });
    await expect(
      repository.listAccounts({ deployment_id: ids.deployment, principal_id: ids.principal }),
    ).resolves.toMatchObject({ ok: false, error: { code: "SUPER_ADMIN_REQUIRED" } });
  });
});
