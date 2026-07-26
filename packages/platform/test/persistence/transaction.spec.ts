import { channel } from "node:diagnostics_channel";
import { describe, expect, it } from "vitest";
import { mapDatabaseRuntimeFailure } from "../../src/persistence/runtime-database-errors.js";
import {
  PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL,
  type PersistenceTransactionDiagnostic,
  type SqlClient,
  type SqlPool,
  type SqlQueryResult,
  withAppTransaction,
} from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const appId = "00000000-0000-4000-8000-000000000001";
const tenantId = "00000000-0000-4000-8000-000000000011";
const deploymentId = "00000000-0000-4000-8000-0000000000d1";

function issueCapability(role: "OWNER" | "ANALYST" | "VIEWER" = "ANALYST") {
  const registry = createDeploymentRegistry(
    [{ deployment_id: deploymentId, app_id: appId, environment: "test" }],
    [
      {
        subject: "00000000-0000-4000-8000-000000000101",
        deployment_id: deploymentId,
        tenant_id: tenantId,
        role,
      },
    ],
  );
  const result = registry.resolveForDeployment(deploymentId, {
    subject: "00000000-0000-4000-8000-000000000101",
  });
  if (!result.ok) throw new Error("Capability fixture 创建失败。");
  return {
    capability: result.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
    genericAuthorizer: registry.authorizer,
  };
}

function recordingPool(options: { failWork?: boolean } = {}) {
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  let releases = 0;
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      if (options.failWork && text === "select work") {
        throw Object.assign(new Error("private database detail"), { code: "XX001" });
      }
      if (text.includes("backend_context_matches")) {
        return {
          rows: [{ allowed: true }],
          rowCount: 1,
        } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {
      releases += 1;
    },
  };
  const pool: SqlPool = { connect: async () => client };
  return { calls, pool, releases: () => releases };
}

describe("App-aware PostgreSQL transaction", () => {
  it("fails closed before database I/O when a generic authorizer is misconfigured", async () => {
    let connects = 0;
    const authority = issueCapability();
    const pool: SqlPool = {
      async connect() {
        connects += 1;
        throw new Error("不应连接");
      },
    };

    const result = await withAppTransaction(
      pool,
      // @ts-expect-error 生产接口只接受 TransactionalCapabilityAuthorizer。
      authority.genericAuthorizer,
      authority.capability,
      { access: "READ" },
      async () => "unexpected",
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_DATABASE_AUTHORITY_REQUIRED", retryable: false },
    });
    expect(connects).toBe(0);
  });

  it("rejects forged capability before checking out a database client", async () => {
    let connects = 0;
    const authority = issueCapability();
    const pool: SqlPool = {
      async connect() {
        connects += 1;
        throw new Error("不应连接");
      },
    };

    const result = await withAppTransaction(
      pool,
      authority.authorizer,
      {
        scope: { app_id: appId, tenant_id: tenantId, environment: "test" },
        principal: "forged",
        role: "OWNER",
      },
      { access: "READ" },
      async () => "unexpected",
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "APP_CAPABILITY_REQUIRED", retryable: false },
    });
    expect(connects).toBe(0);
  });

  it("uses one checked-out client, fixed search_path and parameterized scope", async () => {
    const fixture = recordingPool();
    const authority = issueCapability();

    const result = await withAppTransaction(
      fixture.pool,
      authority.authorizer,
      authority.capability,
      { access: "WRITE" },
      async ({ client }) => {
        await client.query("select work", ["payload"]);
        return "done";
      },
    );

    expect(result).toEqual({ ok: true, value: "done" });
    expect(fixture.calls.map((call) => call.text)).toEqual([
      "BEGIN",
      "SET LOCAL search_path TO app_data_agent, pg_catalog",
      expect.stringContaining("pg_catalog.set_config('data_agent.app_id', $1, true)"),
      expect.stringContaining("platform.backend_context_matches"),
      "select work",
      "COMMIT",
    ]);
    expect(fixture.calls[2]?.values).toEqual([
      appId,
      tenantId,
      "test",
      "00000000-0000-4000-8000-000000000101",
      "analyst",
      deploymentId,
    ]);
    const databaseContext = fixture.calls.find(({ text }) =>
      text.includes("platform.backend_context_matches"),
    );
    expect(databaseContext?.values).toEqual([appId, tenantId, "test", true]);
    expect(fixture.releases()).toBe(1);
  });

  it("rolls back, releases the client and redacts unknown database errors", async () => {
    const fixture = recordingPool({ failWork: true });
    const authority = issueCapability();
    const diagnosticChannel = channel(PERSISTENCE_TRANSACTION_DIAGNOSTIC_CHANNEL);
    const diagnostics: PersistenceTransactionDiagnostic[] = [];
    const capture = (message: unknown) => {
      diagnostics.push(message as PersistenceTransactionDiagnostic);
    };
    diagnosticChannel.subscribe(capture);
    const result = await withAppTransaction(
      fixture.pool,
      authority.authorizer,
      authority.capability,
      {
        access: "WRITE",
        operation_name: "runtime.test",
        correlation_id: "safe-correlation-id",
      },
      async ({ client }) => {
        await client.query("select work");
      },
    );
    diagnosticChannel.unsubscribe(capture);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PERSISTENCE_TRANSACTION_FAILED",
        retryable: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private database detail");
    expect(diagnostics).toEqual([
      {
        operation_name: "runtime.test",
        correlation_id: "safe-correlation-id",
        error_class: "Error",
        sqlstate: "XX001",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("private database detail");
    expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
    expect(fixture.releases()).toBe(1);
  });

  it("does not translate runtime markers unless the adapter opts in", async () => {
    const fixture = recordingPool();
    const authority = issueCapability();
    const result = await withAppTransaction(
      fixture.pool,
      authority.authorizer,
      authority.capability,
      { access: "WRITE" },
      async () => {
        throw new Error("DA_RUN_EVENT_FENCE_STALE");
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_TRANSACTION_FAILED", retryable: true },
    });
    expect(JSON.stringify(result)).not.toContain("DA_RUN_EVENT_FENCE_STALE");
  });

  it.each([
    {
      marker: "DA_RUN_EVENT_FENCE_STALE",
      code: "RUN_COMMIT_CANCELLED_OR_STALE",
      retryable: false,
    },
    {
      marker: "DA_RUN_LEASE_STALE",
      code: "RUN_QUEUE_STALE_FENCE",
      retryable: false,
    },
    {
      marker: "DA_RUN_WORK_CLAIM_CONFLICT",
      code: "RUN_QUEUE_STALE_FENCE",
      retryable: true,
    },
    {
      marker: "DA_RUN_CHECKPOINT_STALE_LEASE",
      code: "RUN_COMMIT_CANCELLED_OR_STALE",
      retryable: false,
    },
    {
      marker: "DA_RUN_EFFECT_STALE_LEASE",
      code: "RUN_COMMIT_CANCELLED_OR_STALE",
      retryable: false,
    },
    {
      marker: "DA_RUN_PROJECTION_CONFLICT",
      code: "RUN_PROJECTION_CONFLICT",
      retryable: true,
    },
    {
      marker: "DA_RUN_EVENT_HASH_MISMATCH",
      code: "RUN_RUNTIME_HASH_MISMATCH",
      retryable: false,
    },
    {
      marker: "DA_RUN_CHECKPOINT_HASH_MISMATCH",
      code: "RUN_RUNTIME_HASH_MISMATCH",
      retryable: false,
    },
    {
      marker: "DA_RUN_CHECKPOINT_ARTIFACT_INVALID",
      code: "RUN_CHECKPOINT_ARTIFACT_INVALID",
      retryable: false,
    },
    {
      marker: "DA_RUN_EFFECT_ARTIFACT_INVALID",
      code: "RUN_EFFECT_ARTIFACT_INVALID",
      retryable: false,
    },
    {
      marker: "DA_RUN_EVENT_TRANSITION_INVALID",
      code: "RUN_RUNTIME_INVARIANT_VIOLATION",
      retryable: false,
    },
    {
      marker: "DA_RUN_PROJECTION_SEMANTIC_MISMATCH",
      code: "RUN_RUNTIME_INVARIANT_VIOLATION",
      retryable: false,
    },
    {
      marker: "DA_RUN_CONTROL_STATE_INVALID",
      code: "RUN_CONTROL_STATE_INVALID",
      retryable: false,
    },
    {
      marker: "DA_RUN_ALREADY_EXISTS",
      code: "RUN_ALREADY_EXISTS",
      retryable: false,
    },
  ])(
    "maps database concurrency marker $marker to stable runtime error $code",
    async ({ marker, code, retryable }) => {
      const fixture = recordingPool();
      const authority = issueCapability();
      const result = await withAppTransaction(
        fixture.pool,
        authority.authorizer,
        authority.capability,
        { access: "WRITE", map_database_error: mapDatabaseRuntimeFailure },
        async () => {
          throw Object.assign(new Error(marker), { code: "40001" });
        },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code, retryable },
      });
      expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
    },
  );

  it("denies VIEWER writes before opening a transaction", async () => {
    const fixture = recordingPool();
    const authority = issueCapability("VIEWER");
    const result = await withAppTransaction(
      fixture.pool,
      authority.authorizer,
      authority.capability,
      { access: "WRITE" },
      async () => undefined,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_WRITE_DENIED" },
    });
    expect(fixture.calls).toHaveLength(0);
  });
});
