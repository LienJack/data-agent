import {
  buildFalcon24RunExecutionPolicy,
  DEFAULT_RUN_EXECUTION_POLICY,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresRunQueue } from "../../src/queue/postgres-run-queue.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  run: "00000000-0000-4000-8000-000000000201",
  command: "00000000-0000-4000-8000-000000000301",
  outbox: "00000000-0000-4000-8000-000000000501",
  attempt: "00000000-0000-4000-8000-000000000701",
  deployment: "00000000-0000-4000-8000-0000000000d1",
} as const;

const scope = {
  app_id: ids.app,
  tenant_id: ids.tenant,
  environment: "test",
} as const;

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

function scriptedPool(
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

function leaseRow(executionPolicy: unknown = DEFAULT_RUN_EXECUTION_POLICY) {
  return {
    principal_id: ids.principal,
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    command_kind: "START_L2_RESEARCH",
    payload_json: { kind: "START_L2_RESEARCH", run_id: ids.run },
    attempt_id: ids.attempt,
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-a",
    lease_token: "3",
    worker_fence: "4",
    lease_expires_at: "2026-07-25T00:01:00.000Z",
    execution_policy: executionPolicy,
  };
}

describe("PostgreSQL Run Queue", () => {
  it("claims one Run Work while binding Attempt, Lease Token and Run Fence", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("claim_run_work")) {
        return { rows: [leaseRow()], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const queue = createPostgresRunQueue(fixture.pool, authority.authorizer, authority.capability, {
      lease_duration_ms: 30_000,
    });

    await expect(queue.lease({ scope, worker_id: "worker-a" })).resolves.toEqual({
      ok: true,
      value: {
        scope,
        principal_id: ids.principal,
        outbox_id: ids.outbox,
        run_id: ids.run,
        command_id: ids.command,
        command_kind: "START_L2_RESEARCH",
        attempt_id: ids.attempt,
        attempt_no: 1,
        delivery_attempt_no: 1,
        lease_duration_ms: 30_000,
        worker_id: "worker-a",
        lease_token: 3,
        worker_fence: 4,
        expires_at: "2026-07-25T00:01:00.000Z",
        execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
        payload: { kind: "START_L2_RESEARCH", run_id: ids.run },
      },
    });
    expect(fixture.calls.find(({ text }) => text.includes("claim_run_work"))?.values).toEqual([
      "worker-a",
      1,
      30,
      ids.app,
      ids.tenant,
      "test",
      ids.principal,
      DEFAULT_RUN_EXECUTION_POLICY,
    ]);
    const claim = fixture.calls.find(({ text }) => text.includes("claim_run_work"));
    expect(claim?.text).toContain(
      "when work.command_kind = 'RESUME_RUN' then original.command_kind",
    );
    expect(claim?.text).toContain(
      "when work.command_kind = 'RESUME_RUN' then original.payload_json",
    );
    expect(claim?.text).toContain("command.payload_json ? 'effective_config_ref'");
    expect(claim?.text).toContain("work.expires_at as lease_expires_at");
    expect(claim?.text).toContain(
      "app_data_agent.resolve_falcon24_run_execution_policy(run.run_id)",
    );
    expect(claim?.text).toContain("coalesce(");
    expect(claim?.text).not.toContain("pg_catalog.coalesce(");
    expect(claim?.text).not.toContain("join app_data_agent.falcon24_acceptance_campaign_runs");
    expect(claim?.text).not.toContain("join app_data_agent.falcon24_acceptance_campaigns");
  });

  it("atomically binds strict Falcon and default execution policy to the exact leased Run", async () => {
    const strictPolicy = buildFalcon24RunExecutionPolicy({
      campaign_id: "falcon24-root-v12-final",
      case_id: "falcon24-business-review-18m",
      run_variant: "COLD",
      repetition: 1,
    });
    const fixture = scriptedPool((text) =>
      text.includes("claim_run_work") ? { rows: [leaseRow(strictPolicy)], rowCount: 1 } : undefined,
    );
    const authority = issueCapability();
    const queue = createPostgresRunQueue(fixture.pool, authority.authorizer, authority.capability, {
      lease_duration_ms: 30_000,
    });

    await expect(queue.lease({ scope, worker_id: "worker-a" })).resolves.toMatchObject({
      ok: true,
      value: {
        run_id: ids.run,
        execution_policy: strictPolicy,
      },
    });
  });

  it("rolls back a claim whose exact execution policy violates the frozen closure", async () => {
    const fixture = scriptedPool((text) =>
      text.includes("claim_run_work")
        ? {
            rows: [
              leaseRow({
                ...DEFAULT_RUN_EXECUTION_POLICY,
                max_run_attempts: 1,
              }),
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const authority = issueCapability();
    const queue = createPostgresRunQueue(fixture.pool, authority.authorizer, authority.capability, {
      lease_duration_ms: 30_000,
    });

    await expect(queue.lease({ scope, worker_id: "worker-a" })).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_QUEUE_DATABASE_CONTRACT_INVALID", retryable: false },
    });
    expect(fixture.calls.some(({ text }) => text === "ROLLBACK")).toBe(true);
  });

  it("heartbeats, completes and retries only the exact active lease", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("claim_run_work")) {
        return { rows: [leaseRow()], rowCount: 1 };
      }
      if (text.includes("heartbeat_run_work")) {
        return {
          rows: [{ lease_expires_at: "2026-07-25T00:02:00.000Z" }],
          rowCount: 1,
        };
      }
      if (text.includes("complete_run_work")) {
        return { rows: [{ acknowledged: true }], rowCount: 1 };
      }
      if (text.includes("retry_run_work")) {
        return { rows: [{ released: true }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const queue = createPostgresRunQueue(fixture.pool, authority.authorizer, authority.capability, {
      lease_duration_ms: 30_000,
    });
    const leased = await queue.lease({ scope, worker_id: "worker-a" });
    if (!leased.ok || !leased.value) throw new Error("Run Work Lease fixture missing.");
    const lease = leased.value;

    await expect(queue.heartbeat({ lease })).resolves.toEqual({
      ok: true,
      value: { expires_at: "2026-07-25T00:02:00.000Z" },
    });
    await expect(queue.complete({ lease, final_event_sequence: 3 })).resolves.toEqual({
      ok: true,
      value: { acknowledged: true },
    });
    await expect(
      queue.retry({
        lease,
        final_event_sequence: 3,
        error_code: "PROVIDER_TEMPORARY",
        retry_delay_ms: 60_000,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { released: true },
    });

    expect(fixture.calls.find(({ text }) => text.includes("heartbeat_run_work"))?.values).toEqual([
      ids.outbox,
      ids.attempt,
      "worker-a",
      3,
      4,
      30,
    ]);
    expect(fixture.calls.find(({ text }) => text.includes("complete_run_work"))?.values).toEqual([
      ids.outbox,
      ids.attempt,
      "worker-a",
      3,
      4,
      3,
    ]);
    expect(fixture.calls.find(({ text }) => text.includes("retry_run_work"))?.values).toEqual([
      ids.outbox,
      ids.attempt,
      "worker-a",
      3,
      4,
      3,
      "PROVIDER_TEMPORARY",
      60_000,
    ]);
  });

  it("fails closed on stale completion and scope substitution", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const queue = createPostgresRunQueue(fixture.pool, authority.authorizer, authority.capability, {
      lease_duration_ms: 30_000,
    });
    const lease = {
      scope,
      principal_id: ids.principal,
      outbox_id: ids.outbox,
      run_id: ids.run,
      command_id: ids.command,
      command_kind: "START_L2_RESEARCH",
      attempt_id: ids.attempt,
      attempt_no: 1,
      delivery_attempt_no: 1,
      lease_duration_ms: 30_000,
      worker_id: "worker-a",
      lease_token: 3,
      worker_fence: 4,
      expires_at: "2026-07-25T00:01:00.000Z",
      execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      payload: { kind: "START_L2_RESEARCH" },
    } as const;

    await expect(queue.complete({ lease, final_event_sequence: 3 })).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_QUEUE_STALE_FENCE" },
    });
    await expect(
      queue.complete({
        lease: {
          ...lease,
          principal_id: "00000000-0000-4000-8000-000000000102",
        },
        final_event_sequence: 3,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_QUEUE_PRINCIPAL_DENIED" },
    });
    await expect(
      queue.lease({
        scope: { ...scope, tenant_id: "00000000-0000-4000-8000-000000000099" },
        worker_id: "worker-a",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_QUEUE_SCOPE_DENIED" },
    });
  });
});
