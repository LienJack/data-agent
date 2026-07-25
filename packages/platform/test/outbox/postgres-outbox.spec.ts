import { describe, expect, it } from "vitest";
import { createPostgresOutbox } from "../../src/outbox/postgres-outbox.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  run: "00000000-0000-4000-8000-000000000201",
  command: "00000000-0000-4000-8000-000000000301",
  outbox: "00000000-0000-4000-8000-000000000501",
  deployment: "00000000-0000-4000-8000-0000000000d1",
};

function issueCapability() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const result = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!result.ok) throw new Error("Capability fixture 创建失败。");
  return {
    capability: result.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

interface Call {
  readonly text: string;
  readonly values: readonly unknown[];
}

function outboxPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Call[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      const handled = handle(text, values);
      if (handled) return handled as SqlQueryResult<Row>;
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlPool = { connect: async () => client };
  return { calls, pool };
}

function leaseRow() {
  return {
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    topic: "run-command",
    payload_json: { run_id: ids.run, command_id: ids.command },
    attempt_count: 1,
    lease_owner: "worker-a",
    lease_token: "7",
    lease_expires_at: "2026-07-25T00:01:00.000Z",
  };
}

describe("PostgreSQL transactional outbox", () => {
  it("claims with SKIP LOCKED, publishes idempotently and acknowledges the exact fence", async () => {
    const fixture = outboxPool((text) => {
      if (text.includes("claim_outbox")) {
        return { rows: [leaseRow()], rowCount: 1 };
      }
      if (text.includes("publish_outbox")) {
        return { rows: [{ published: true }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const outbox = createPostgresOutbox(fixture.pool, authority.authorizer);
    const published: unknown[] = [];

    const result = await outbox.publishOne(
      authority.capability,
      { worker_id: "worker-a", lease_duration_ms: 30_000 },
      {
        async publish(message) {
          published.push(message);
        },
      },
    );

    expect(result).toEqual({
      ok: true,
      value: { state: "PUBLISHED", outbox_id: ids.outbox },
    });
    expect(published).toEqual([
      expect.objectContaining({
        idempotency_key: ids.outbox,
        attributes: expect.objectContaining({ lease_token: "7" }),
      }),
    ]);
    const claim = fixture.calls.find(({ text }) => text.includes("claim_outbox"));
    expect(claim?.values).toEqual(["worker-a", 30]);
    const acknowledge = fixture.calls.find(({ text }) => text.includes("publish_outbox"));
    expect(acknowledge?.values).toEqual([ids.outbox, "worker-a", "7"]);
  });

  it("returns a failed publish to PENDING without exposing the sink error", async () => {
    const fixture = outboxPool((text) => {
      if (text.includes("claim_outbox")) {
        return { rows: [leaseRow()], rowCount: 1 };
      }
      if (text.includes("retry_outbox")) {
        return { rows: [{ released: true }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const outbox = createPostgresOutbox(fixture.pool, authority.authorizer);

    const result = await outbox.publishOne(
      authority.capability,
      { worker_id: "worker-a", lease_duration_ms: 30_000 },
      {
        async publish() {
          throw new Error("credential=should-not-leak");
        },
      },
      2_000,
    );

    expect(result).toEqual({
      ok: true,
      value: { state: "RETRY_SCHEDULED", outbox_id: ids.outbox },
    });
    expect(JSON.stringify(result)).not.toContain("should-not-leak");
    const retry = fixture.calls.find(({ text }) => text.includes("retry_outbox"));
    expect(retry?.values).toEqual([ids.outbox, "worker-a", "7", 2_000]);
  });

  it("fails closed when the acknowledgment fence is stale", async () => {
    const fixture = outboxPool((text) => {
      if (text.includes("claim_outbox")) {
        return { rows: [leaseRow()], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const outbox = createPostgresOutbox(fixture.pool, authority.authorizer);

    const result = await outbox.publishOne(
      authority.capability,
      { worker_id: "worker-a", lease_duration_ms: 30_000 },
      { publish: async () => {} },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "OUTBOX_LEASE_STALE", retryable: false },
    });
  });
});
