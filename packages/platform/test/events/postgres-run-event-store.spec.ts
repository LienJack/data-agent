import {
  DEFAULT_RUN_EXECUTION_POLICY,
  hashRunProjection,
  replayRunProjection,
  runRuntimeEventSchema,
  runWorkLeaseSchema,
  sha256ContentHash,
  workerRunRuntimeEventSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresRunEventStore } from "../../src/events/postgres-run-event-store.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  run: "00000000-0000-4000-8000-000000000201",
  command: "00000000-0000-4000-8000-000000000301",
  eventAccepted: "00000000-0000-4000-8000-000000000401",
  eventLeased: "00000000-0000-4000-8000-000000000402",
  eventSequenceConflict: "00000000-0000-4000-8000-000000000403",
  eventSuspended: "00000000-0000-4000-8000-000000000404",
  eventCompleted: "00000000-0000-4000-8000-000000000405",
  eventFenceConflict: "00000000-0000-4000-8000-000000000406",
  eventFailed: "00000000-0000-4000-8000-000000000407",
  eventTransitionConflict: "00000000-0000-4000-8000-000000000408",
  otherRun: "00000000-0000-4000-8000-000000000299",
  artifact: "00000000-0000-4000-8000-000000000601",
  attempt: "00000000-0000-4000-8000-000000000701",
  snapshot: "00000000-0000-4000-8000-000000000801",
  receipt: "00000000-0000-4000-8000-000000000901",
  deployment: "00000000-0000-4000-8000-0000000000d1",
} as const;
const hashes = {
  payload: `sha256:${"a".repeat(64)}`,
  workflow: `sha256:${"b".repeat(64)}`,
  input: `sha256:${"c".repeat(64)}`,
  output: `sha256:${"d".repeat(64)}`,
} as const;
const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "test" } as const;

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

const accepted = runRuntimeEventSchema.parse({
  schema_version: "1.0.0",
  event_id: ids.eventAccepted,
  scope,
  run_id: ids.run,
  sequence: 1,
  worker_fence: 0,
  idempotency_key: `event:${ids.eventAccepted}`,
  occurred_at: "2026-07-25T00:00:00.000Z",
  event_type: "run.accepted",
  payload: { command_id: ids.command, payload_hash: hashes.payload },
});

const leased = workerRunRuntimeEventSchema.parse({
  schema_version: "1.0.0",
  event_id: ids.eventLeased,
  scope,
  run_id: ids.run,
  sequence: 2,
  worker_fence: 1,
  idempotency_key: `event:${ids.eventLeased}`,
  occurred_at: "2026-07-25T00:00:01.000Z",
  event_type: "run.leased",
  payload: {
    command_id: ids.command,
    lease_id: "lease-1",
    worker_id: "worker-a",
    attempt: 1,
  },
});
const lease = runWorkLeaseSchema.parse({
  scope,
  principal_id: ids.principal,
  outbox_id: "00000000-0000-4000-8000-000000000501",
  run_id: ids.run,
  command_id: ids.command,
  command_kind: "START_L2_RESEARCH",
  attempt_id: ids.attempt,
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 30_000,
  worker_id: "worker-a",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-07-25T00:01:00.000Z",
  payload: {},
  execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
});
const acceptedHash = await sha256ContentHash(accepted);
const leasedHash = await sha256ContentHash(leased);

function acceptedRow() {
  return {
    app_id: scope.app_id,
    tenant_id: scope.tenant_id,
    environment: scope.environment,
    event_id: accepted.event_id,
    run_id: accepted.run_id,
    sequence: "1",
    event_type: accepted.event_type,
    payload_json: accepted.payload,
    worker_fence: "0",
    dedupe_key: accepted.idempotency_key,
    event_hash: acceptedHash,
    event_document: accepted,
    created_at: accepted.occurred_at,
  };
}

describe("PostgreSQL Run Event Store", () => {
  it("appends one fenced Event and stores the exact deterministic Projection", async () => {
    const initialProjection = replayRunProjection([accepted]);
    const expectedProjectionHash = await hashRunProjection(initialProjection);
    const expectedProjection = replayRunProjection([accepted, leased]);
    const nextProjectionHash = await hashRunProjection(expectedProjection);
    const eventHash = await sha256ContentHash(leased);
    const fixture = scriptedPool((text) => {
      if (text.includes("from run_projections")) return { rows: [], rowCount: 0 };
      if (
        text.includes("from run_events") &&
        text.includes("order by sequence") &&
        !text.includes("order by sequence desc")
      ) {
        return { rows: [acceptedRow()], rowCount: 1 };
      }
      if (text.includes("append_run_event")) {
        return {
          rows: [
            {
              result: {
                replayed: false,
                event: leased,
                event_hash: eventHash,
                projection: expectedProjection,
                projection_hash: nextProjectionHash,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    const result = await store.append({
      lease,
      event: leased,
      expected_projection: {
        projection: initialProjection,
        projection_hash: expectedProjectionHash,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        replayed: false,
        event: leased,
        projection: { status: "RUNNING", version: 2, worker_fence: 1 },
      },
    });
    const call = fixture.calls.find(({ text }) => text.includes("append_run_event"));
    expect(call?.values).toHaveLength(6);
    expect(call?.values[0]).toEqual(JSON.stringify(lease));
    expect(call?.values[1]).toEqual(JSON.stringify(leased));
    expect(call?.values[3]).toBe(expectedProjectionHash);
    expect(call?.values[4]).toEqual(JSON.stringify(expectedProjection));
    expect(fixture.calls.some(({ text }) => text.includes("from run_projections"))).toBe(false);
    expect(fixture.calls.some(({ text }) => text.includes("sequence > $5"))).toBe(false);
    expect(
      fixture.calls.some(
        ({ text }) => text.includes("from run_events") && text.includes("event_id = $6"),
      ),
    ).toBe(false);

    await expect(
      store.append({
        lease: {
          ...lease,
          principal_id: "00000000-0000-4000-8000-000000000102",
        },
        event: leased,
        expected_projection: {
          projection: initialProjection,
          projection_hash: expectedProjectionHash,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_EVENT_STORE_PRINCIPAL_DENIED" },
    });
  });

  it("maps local Projection reducer failures to the stable database-facing contract", async () => {
    const suspended = workerRunRuntimeEventSchema.parse({
      schema_version: "1.0.0",
      event_id: ids.eventSuspended,
      scope,
      run_id: ids.run,
      sequence: 3,
      worker_fence: 1,
      idempotency_key: `event:${ids.eventSuspended}`,
      occurred_at: "2026-07-25T00:00:02.000Z",
      event_type: "run.suspended",
      payload: {
        reason_code: "WAITING_FOR_INPUT",
        snapshot_id: ids.snapshot,
      },
    });
    const completed = workerRunRuntimeEventSchema.parse({
      schema_version: "1.0.0",
      event_id: ids.eventCompleted,
      scope,
      run_id: ids.run,
      sequence: 3,
      worker_fence: 1,
      idempotency_key: `event:${ids.eventCompleted}`,
      occurred_at: "2026-07-25T00:00:02.000Z",
      event_type: "run.completed",
      payload: { completion_kind: "WORKFLOW_EXECUTION_ONLY" },
    });
    const acceptedProjection = replayRunProjection([accepted]);
    const runningProjection = replayRunProjection([accepted, leased]);
    const waitingProjection = replayRunProjection([accepted, leased, suspended]);
    const terminalProjection = replayRunProjection([accepted, leased, completed]);
    const advancedFenceLease = runWorkLeaseSchema.parse({
      ...lease,
      lease_token: 2,
      worker_fence: 2,
    });
    const cases = [
      {
        projection: acceptedProjection,
        lease,
        event: workerRunRuntimeEventSchema.parse({
          ...completed,
          event_id: ids.eventSequenceConflict,
          idempotency_key: `event:${ids.eventSequenceConflict}`,
        }),
        code: "RUN_PROJECTION_CONFLICT",
        retryable: true,
      },
      {
        projection: runningProjection,
        lease: advancedFenceLease,
        event: workerRunRuntimeEventSchema.parse({
          ...completed,
          event_id: ids.eventFenceConflict,
          worker_fence: 2,
          idempotency_key: `event:${ids.eventFenceConflict}`,
        }),
        code: "RUN_COMMIT_CANCELLED_OR_STALE",
        retryable: false,
      },
      {
        projection: terminalProjection,
        lease,
        event: workerRunRuntimeEventSchema.parse({
          schema_version: "1.0.0",
          event_id: ids.eventFailed,
          scope,
          run_id: ids.run,
          sequence: 4,
          worker_fence: 1,
          idempotency_key: `event:${ids.eventFailed}`,
          occurred_at: "2026-07-25T00:00:03.000Z",
          event_type: "run.failed",
          payload: { error_code: "WORKFLOW_FAILED", retryable: false },
        }),
        code: "RUN_COMMIT_CANCELLED_OR_STALE",
        retryable: false,
      },
      {
        projection: waitingProjection,
        lease,
        event: workerRunRuntimeEventSchema.parse({
          ...completed,
          event_id: ids.eventTransitionConflict,
          sequence: 4,
          idempotency_key: `event:${ids.eventTransitionConflict}`,
        }),
        code: "RUN_RUNTIME_INVARIANT_VIOLATION",
        retryable: false,
      },
    ] as const;

    for (const testCase of cases) {
      const fixture = scriptedPool(() => undefined);
      const authority = issueCapability();
      const store = createPostgresRunEventStore(
        fixture.pool,
        authority.authorizer,
        authority.capability,
      );

      await expect(
        store.append({
          lease: testCase.lease,
          event: testCase.event,
          expected_projection: {
            projection: testCase.projection,
            projection_hash: await hashRunProjection(testCase.projection),
          },
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: testCase.code,
          retryable: testCase.retryable,
        },
      });
      expect(fixture.calls.some(({ text }) => text.includes("append_run_event"))).toBe(false);
      expect(fixture.calls.at(-1)?.text).toBe("ROLLBACK");
    }
  });

  it("reads only the durable Event gap after an SSE Projection cursor", async () => {
    const fixture = scriptedPool((text) => {
      if (
        text.includes("from run_events") &&
        text.includes("sequence > $5") &&
        !text.includes("order by sequence desc")
      ) {
        return {
          rows: [
            {
              ...acceptedRow(),
              event_id: leased.event_id,
              sequence: "2",
              event_type: leased.event_type,
              payload_json: leased.payload,
              worker_fence: "1",
              dedupe_key: leased.idempotency_key,
              event_hash: leasedHash,
              event_document: leased,
              created_at: leased.occurred_at,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(
      store.listEvents({
        scope,
        run_id: ids.run,
        after_sequence: 1,
        limit: 100,
      }),
    ).resolves.toEqual({
      ok: true,
      value: [leased],
    });
    const eventGapRead = fixture.calls.find(({ text }) => text.includes("sequence > $5"));
    expect(eventGapRead?.values).toEqual([
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      ids.run,
      1,
      100,
    ]);
  });

  it("preserves the v2 schema version while verifying relational Event columns", async () => {
    const v2 = runRuntimeEventSchema.parse({
      schema_version: "run-runtime-event@2.0.0",
      event_id: ids.eventSequenceConflict,
      scope,
      run_id: ids.run,
      sequence: 3,
      worker_fence: 1,
      idempotency_key: "v2:agent:running",
      occurred_at: "2026-07-25T00:00:02.000Z",
      event_type: "run.agent_status",
      payload: {
        profile_id: "governed-text2sql-agent",
        task_id: "00000000-0000-4000-8000-000000000777",
        status: "RUNNING",
        phase: "compile.query",
        title: "Text2SQL",
        summary: "正在编译查询",
        duration_ms: null,
        error_code: null,
      },
    });
    const v2Hash = await sha256ContentHash(v2);
    const fixture = scriptedPool((text) => {
      if (text.includes("sequence > $5") && !text.includes("order by sequence desc")) {
        return {
          rows: [
            {
              ...acceptedRow(),
              event_id: v2.event_id,
              sequence: "3",
              event_type: v2.event_type,
              payload_json: v2.payload,
              worker_fence: "1",
              dedupe_key: v2.idempotency_key,
              event_hash: v2Hash,
              event_document: v2,
              created_at: v2.occurred_at,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );
    await expect(
      store.listEvents({ scope, run_id: ids.run, after_sequence: 2, limit: 100 }),
    ).resolves.toEqual({ ok: true, value: [v2] });
  });

  it("rejects an unbounded Event gap request before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(
      store.listEvents({
        scope,
        run_id: ids.run,
        after_sequence: 0,
        limit: 501,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_INPUT_INVALID",
        retryable: false,
      },
    });
    expect(fixture.calls).toHaveLength(0);
  });

  it("looks up one Event by its indexed idempotency identity without scanning Run history", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("dedupe_key = $5") && text.includes("limit 1")) {
        return { rows: [acceptedRow()], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(
      store.findEventByIdempotencyKey({
        scope,
        run_id: ids.run,
        idempotency_key: accepted.idempotency_key,
      }),
    ).resolves.toEqual({
      ok: true,
      value: accepted,
    });
    const identityRead = fixture.calls.find(({ text }) => text.includes("dedupe_key = $5"));
    expect(identityRead?.values).toEqual([
      scope.app_id,
      scope.tenant_id,
      scope.environment,
      ids.run,
      accepted.idempotency_key,
    ]);
    expect(identityRead?.text).not.toContain("order by sequence");
  });

  it.each([
    ["missing", null],
    ["mismatched", hashes.payload],
  ])("fails closed when an indexed Event has a %s hash", async (_label, eventHash) => {
    expect(eventHash).not.toBe(acceptedHash);
    const fixture = scriptedPool((text) => {
      if (text.includes("dedupe_key = $5") && text.includes("limit 1")) {
        return {
          rows: [{ ...acceptedRow(), event_hash: eventHash }],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(
      store.findEventByIdempotencyKey({
        scope,
        run_id: ids.run,
        idempotency_key: accepted.idempotency_key,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_EVENT_CORRUPT",
        retryable: false,
      },
    });
  });

  it("maps a malformed stored Event envelope to a stable non-retryable corruption error", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("dedupe_key = $5") && text.includes("limit 1")) {
        return {
          rows: [{ ...acceptedRow(), event_document: { malformed: true } }],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(
      store.findEventByIdempotencyKey({
        scope,
        run_id: ids.run,
        idempotency_key: accepted.idempotency_key,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_EVENT_CORRUPT",
        retryable: false,
      },
    });
  });

  it("treats missing Projection with existing Events as corruption instead of unbounded replay", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("from run_projections")) return { rows: [], rowCount: 0 };
      if (text.includes("select exists") && text.includes("from run_events")) {
        return { rows: [{ exists: true }], rowCount: 1 };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(store.readProjection({ scope, run_id: ids.run })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_PROJECTION_CORRUPT",
        retryable: false,
      },
    });
    expect(fixture.calls.some(({ text }) => text.includes("sequence > $5"))).toBe(false);
  });

  it("rejects a caller-supplied Projection whose content does not match its hash", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );
    const initialProjection = replayRunProjection([accepted]);
    expect(await hashRunProjection(initialProjection)).not.toBe(hashes.payload);

    await expect(
      store.append({
        lease,
        event: leased,
        expected_projection: {
          projection: initialProjection,
          projection_hash: hashes.payload,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_INPUT_INVALID",
        retryable: false,
      },
    });
    expect(fixture.calls).toHaveLength(0);
  });

  it("rejects a replay response whose self-consistent Projection belongs to another Run", async () => {
    const initialProjection = replayRunProjection([accepted]);
    const initialProjectionHash = await hashRunProjection(initialProjection);
    const foreignProjection = {
      ...replayRunProjection([accepted, leased]),
      run_id: ids.otherRun,
    };
    const foreignProjectionHash = await hashRunProjection(foreignProjection);
    const eventHash = await sha256ContentHash(leased);
    const fixture = scriptedPool((text) => {
      if (text.includes("append_run_event")) {
        return {
          rows: [
            {
              result: {
                replayed: true,
                event: leased,
                event_hash: eventHash,
                projection: foreignProjection,
                projection_hash: foreignProjectionHash,
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(
      store.append({
        lease,
        event: leased,
        expected_projection: {
          projection: initialProjection,
          projection_hash: initialProjectionHash,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_DATABASE_CONTRACT_INVALID",
        retryable: false,
      },
    });
  });

  it("rejects a caller-supplied Snapshot Hash before database I/O", async () => {
    const fixture = scriptedPool(() => undefined);
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );
    const body = {
      schema_version: "1.0.0",
      authority: "EXECUTION_SNAPSHOT_ONLY",
      snapshot_id: ids.snapshot,
      scope,
      run_id: ids.run,
      workflow_id: "l2-research",
      workflow_definition_revision: hashes.workflow,
      mastra_core_version: "1.52.1",
      mastra_run_id: "mastra-run-1",
      attempt_id: ids.attempt,
      snapshot_version: 1,
      event_sequence: 2,
      worker_fence: 1,
      active_artifact_ref: null,
      mastra_snapshot: {
        runId: "mastra-run-1",
        status: "suspended",
        timestamp: 1,
      },
      created_at: "2026-07-25T00:00:02.000Z",
    } as const;
    await expect(
      store.commitSnapshot({
        lease,
        binding: { ...body, snapshot_hash: hashes.payload } as never,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_EVENT_STORE_INPUT_INVALID" },
    });
    expect(fixture.calls).toHaveLength(0);
  });

  it("commits and restores only the Snapshot referenced by the latest Projection", async () => {
    const body = {
      schema_version: "1.0.0",
      authority: "EXECUTION_SNAPSHOT_ONLY",
      snapshot_id: ids.snapshot,
      scope,
      run_id: ids.run,
      workflow_id: "l2-research",
      workflow_definition_revision: hashes.workflow,
      mastra_core_version: "1.52.1",
      mastra_run_id: "mastra-run-1",
      attempt_id: ids.attempt,
      snapshot_version: 1,
      event_sequence: 2,
      worker_fence: 1,
      active_artifact_ref: null,
      mastra_snapshot: {
        runId: "mastra-run-1",
        status: "suspended",
        timestamp: 1,
      },
      created_at: "2026-07-25T00:00:02.000Z",
    } as const;
    const binding = {
      ...body,
      snapshot_hash: hashes.payload,
    };
    const fixture = scriptedPool((text) => {
      if (text.includes("commit_run_checkpoint")) {
        return {
          rows: [{ result: { created: true, binding } }],
          rowCount: 1,
        };
      }
      if (text.includes("join run_checkpoints")) {
        return {
          rows: [
            {
              active_snapshot_ref: {
                snapshot_id: binding.snapshot_id,
                snapshot_version: binding.snapshot_version,
                snapshot_hash: binding.snapshot_hash,
              },
              snapshot_json: binding,
              stored_snapshot_hash: binding.snapshot_hash,
              recomputed_snapshot_hash: binding.snapshot_hash,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(store.commitSnapshot({ lease, binding: body })).resolves.toEqual({
      ok: true,
      value: { created: true, binding },
    });
    await expect(store.loadLatestSnapshot({ scope, run_id: ids.run })).resolves.toEqual({
      ok: true,
      value: binding,
    });
    const snapshotRead = fixture.calls.find(({ text }) => text.includes("join run_checkpoints"));
    expect(snapshotRead?.text).toContain("binding_json as snapshot_json");
    expect(snapshotRead?.text).toContain("active_snapshot_ref");
    expect(snapshotRead?.text).toContain("order by candidate.version desc");
  });

  it("fails closed when the latest Projection references a missing Snapshot", async () => {
    const fixture = scriptedPool((text) => {
      if (text.includes("join run_checkpoints")) {
        return {
          rows: [
            {
              active_snapshot_ref: {
                snapshot_id: ids.snapshot,
                snapshot_version: 1,
                snapshot_hash: hashes.workflow,
              },
              snapshot_json: null,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(store.loadLatestSnapshot({ scope, run_id: ids.run })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_SNAPSHOT_CORRUPT",
        retryable: false,
      },
    });
  });

  it("fails closed when PostgreSQL recomputes a different stored Snapshot Hash", async () => {
    const binding = {
      schema_version: "1.0.0",
      authority: "EXECUTION_SNAPSHOT_ONLY",
      snapshot_id: ids.snapshot,
      scope,
      run_id: ids.run,
      workflow_id: "l2-research",
      workflow_definition_revision: hashes.workflow,
      mastra_core_version: "1.52.1",
      mastra_run_id: "mastra-run-1",
      attempt_id: ids.attempt,
      snapshot_version: 1,
      event_sequence: 2,
      worker_fence: 1,
      active_artifact_ref: null,
      mastra_snapshot: {
        runId: "mastra-run-1",
        status: "suspended",
      },
      created_at: "2026-07-25T00:00:02.000Z",
      snapshot_hash: hashes.payload,
    } as const;
    const fixture = scriptedPool((text) => {
      if (text.includes("join run_checkpoints")) {
        return {
          rows: [
            {
              active_snapshot_ref: {
                snapshot_id: binding.snapshot_id,
                snapshot_version: binding.snapshot_version,
                snapshot_hash: binding.snapshot_hash,
              },
              snapshot_json: binding,
              stored_snapshot_hash: binding.snapshot_hash,
              recomputed_snapshot_hash: hashes.workflow,
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );

    await expect(store.loadLatestSnapshot({ scope, run_id: ids.run })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "RUN_EVENT_STORE_SNAPSHOT_CORRUPT",
        retryable: false,
      },
    });
  });

  it("commits and reuses a content-addressed Side Effect Receipt", async () => {
    const receipt = {
      schema_version: "1.0.0",
      receipt_id: ids.receipt,
      scope,
      run_id: ids.run,
      effect_kind: "SQL",
      input_hash: hashes.input,
      output_hash: hashes.output,
      worker_fence: 1,
      committed_at: "2026-07-25T00:00:02.000Z",
    } as const;
    const fixture = scriptedPool((text) => {
      if (text.includes("commit_run_effect_receipt")) {
        return {
          rows: [{ result: { created: false, receipt } }],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = issueCapability();
    const store = createPostgresRunEventStore(
      fixture.pool,
      authority.authorizer,
      authority.capability,
    );
    const competingReceipt = {
      ...receipt,
      receipt_id: "00000000-0000-4000-8000-000000000902",
      committed_at: "2026-07-25T00:00:03.000Z",
    } as const;

    await expect(store.commitSideEffect({ lease, receipt: competingReceipt })).resolves.toEqual({
      ok: true,
      value: { created: false, receipt },
    });
  });
});
