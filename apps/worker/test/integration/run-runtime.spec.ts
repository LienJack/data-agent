import { randomUUID } from "node:crypto";
import {
  computeMastraSnapshotBindingHash,
  type PortResult,
  type RunEventStorePort,
  type RunQueuePort,
  replayRunProjection,
} from "@data-agent/contracts";
import {
  adaptPgPool,
  createPostgresCapabilityAuthority,
  createPostgresRepository,
  createPostgresRunControl,
  createPostgresRunEventStore,
  createPostgresRunQueue,
} from "@data-agent/platform";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createRunWorkerRunner, type RunWorkflowExecutorPort } from "../../src/runs/index.js";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
  effectiveConfigRef,
} from "../runs/support/effective-config-fixture.js";

const DEPLOYMENT_ID = "00000000-0000-4000-8000-00000000de01";
const databaseUrl = process.env.DATA_AGENT_TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.DATA_AGENT_TEST_ADMIN_DATABASE_URL;

function interruptedAppend(): PortResult<never> {
  return {
    ok: false,
    error: {
      code: "RUN_EVENT_APPEND_INTERRUPTED",
      message: "测试模拟 Receipt 提交后的进程中断。",
      retryable: true,
    },
  };
}

describe.skipIf(!databaseUrl || !adminDatabaseUrl)("PostgreSQL durable Run runtime", () => {
  const backendPool = new Pool({ connectionString: databaseUrl });
  const adminPool = new Pool({ connectionString: adminDatabaseUrl });
  const sqlPool = adaptPgPool(backendPool);
  const authority = createPostgresCapabilityAuthority(sqlPool);

  afterAll(async () => {
    await Promise.all([backendPool.end(), adminPool.end()]);
  });

  async function isolatedCapability() {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    await adminPool.query(
      "select platform.provision_membership($1::uuid, $2::uuid, $3::uuid, 'owner')",
      [DEPLOYMENT_ID, tenantId, ownerId],
    );
    const resolved = await authority.resolveForServerContext({
      deployment_id: DEPLOYMENT_ID,
      tenant_id: tenantId,
      principal_id: ownerId,
      access: "WRITE",
    });
    if (!resolved.ok) throw new Error(resolved.error.code);
    return resolved.value;
  }

  async function acceptRun(question: string) {
    const authorized = await isolatedCapability();
    const repository = createPostgresRepository(sqlPool, authority.authorizer);
    const runId = randomUUID();
    const effectiveConfig = await buildWorkerEffectiveConfigFixture({
      scope: authorized.scope,
      workspace_id: authorized.scope.tenant_id,
      principal_id: authorized.principal,
      run_id: runId,
    });
    const command = {
      run_id: runId,
      command_id: randomUUID(),
      event_id: randomUUID(),
      outbox_id: randomUUID(),
      audit_id: randomUUID(),
      idempotency_key: `runtime-${randomUUID()}`,
      question,
      payload: {
        kind: "START_L2_RESEARCH",
        effective_config_ref: effectiveConfigRef(effectiveConfig),
      },
    };
    const accepted = await repository.acceptCommand(authorized, command);
    if (!accepted.ok) throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
    return {
      authorized,
      command,
      effectiveConfigLoader: createEffectiveConfigFixtureLoader(effectiveConfig),
    };
  }

  it("reclaims a crash before run.leased and projects the authoritative Attempt number", {
    timeout: 20_000,
  }, async () => {
    const { authorized, command, effectiveConfigLoader } = await acceptRun(
      "验证 Lease Event 前崩溃仍能按 Attempt 2 恢复",
    );
    const queue = createPostgresRunQueue(sqlPool, authority.authorizer, authorized, {
      lease_duration_ms: 5_000,
    });
    const store = createPostgresRunEventStore(sqlPool, authority.authorizer, authorized);
    let interruptLeaseEvent = true;
    const interruptedStore: RunEventStorePort = {
      ...store,
      async append(input) {
        if (interruptLeaseEvent && input.event.event_type === "run.leased") {
          interruptLeaseEvent = false;
          return interruptedAppend();
        }
        return store.append(input);
      },
    };
    let executions = 0;
    const executor: RunWorkflowExecutorPort = {
      async execute() {
        executions += 1;
        return { kind: "COMPLETED" };
      },
    };

    const firstRunner = createRunWorkerRunner({
      queue,
      event_store: interruptedStore,
      effective_config_loader: effectiveConfigLoader,
      executor,
    });
    await expect(
      firstRunner.runOnce({ scope: authorized.scope, worker_id: "pre-lease-crash-worker" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_EVENT_APPEND_INTERRUPTED" },
    });
    expect(executions).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 5_500));
    const secondRunner = createRunWorkerRunner({
      queue,
      event_store: store,
      effective_config_loader: effectiveConfigLoader,
      executor,
    });
    await expect(
      secondRunner.runOnce({ scope: authorized.scope, worker_id: "pre-lease-takeover-worker" }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", run_id: command.run_id },
    });
    expect(executions).toBe(1);

    const projection = await store.readProjection({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    if (!projection.ok || !projection.value) {
      throw new Error("Pre-lease takeover projection evidence missing.");
    }
    expect(projection.value.projection).toMatchObject({
      status: "COMPLETED",
      attempt_count: 2,
      worker_fence: 2,
    });
  });

  it("reclaims an expired crash with a higher Fence and reuses the committed Side Effect Receipt", {
    timeout: 20_000,
  }, async () => {
    const { authorized, command, effectiveConfigLoader } = await acceptRun(
      "验证崩溃恢复不会重复执行 SQL",
    );
    const queue = createPostgresRunQueue(sqlPool, authority.authorizer, authorized, {
      lease_duration_ms: 5_000,
    });
    const store = createPostgresRunEventStore(sqlPool, authority.authorizer, authorized);
    let interruptSideEffectEvent = true;
    const interruptedStore: RunEventStorePort = {
      ...store,
      async append(input) {
        if (interruptSideEffectEvent && input.event.event_type === "run.side_effect_committed") {
          interruptSideEffectEvent = false;
          return interruptedAppend();
        }
        return store.append(input);
      },
    };
    let effectExecutions = 0;
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        const receipt = await context.executeSideEffectOnce({
          effect_kind: "SQL",
          input: {
            query_hash: `sha256:${"1".repeat(64)}`,
            snapshot: "integration-v1",
          },
          async execute() {
            effectExecutions += 1;
            return { output: { rows: [{ value: 42 }] } };
          },
        });
        if (!receipt.ok) throw new Error(receipt.error.code);
        return { kind: "COMPLETED" };
      },
    };
    const firstRunner = createRunWorkerRunner({
      queue,
      event_store: interruptedStore,
      effective_config_loader: effectiveConfigLoader,
      executor,
    });

    await expect(
      firstRunner.runOnce({ scope: authorized.scope, worker_id: "runtime-worker-a" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKER_PROCESS_CRASH" },
    });
    expect(effectExecutions).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 5_500));
    const secondRunner = createRunWorkerRunner({
      queue,
      event_store: store,
      effective_config_loader: effectiveConfigLoader,
      executor,
    });
    await expect(
      secondRunner.runOnce({ scope: authorized.scope, worker_id: "runtime-worker-b" }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", run_id: command.run_id },
    });
    expect(effectExecutions).toBe(1);

    const events = await store.listEvents({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    const live = await store.readProjection({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    if (!events.ok || !live.ok || !live.value) throw new Error("Runtime replay evidence missing.");
    expect(replayRunProjection(events.value)).toEqual(live.value.projection);
    expect(live.value.projection).toMatchObject({
      status: "COMPLETED",
      attempt_count: 2,
      worker_fence: 2,
    });

    const persisted = await adminPool.query(
      `select
           (select count(*)::int
              from app_data_agent.run_effect_receipts
             where run_id = $1) as receipts,
           (select count(*)::int
              from app_data_agent.run_attempts
             where run_id = $1) as attempts,
           (select active_fence::int
              from app_data_agent.runs
             where run_id = $1) as active_fence`,
      [command.run_id],
    );
    expect(persisted.rows[0]).toEqual({
      receipts: 1,
      attempts: 2,
      active_fence: 2,
    });
  });

  it("raises the cancel Fence during streaming and rejects the late completion", async () => {
    const { authorized, command, effectiveConfigLoader } = await acceptRun(
      "验证 Provider Streaming 期间取消",
    );
    const queue = createPostgresRunQueue(sqlPool, authority.authorizer, authorized, {
      lease_duration_ms: 10_000,
    });
    const store = createPostgresRunEventStore(sqlPool, authority.authorizer, authorized);
    const control = createPostgresRunControl(sqlPool, authority.authorizer, authorized);
    const runner = createRunWorkerRunner({
      queue,
      event_store: store,
      effective_config_loader: effectiveConfigLoader,
      executor: {
        async execute() {
          const cancelled = await control.submit({
            schema_version: "1.0.0",
            scope: authorized.scope,
            operation: "CANCEL",
            run_id: command.run_id,
            command_id: randomUUID(),
            event_id: randomUUID(),
            outbox_id: randomUUID(),
            audit_id: randomUUID(),
            idempotency_key: `cancel-${randomUUID()}`,
            occurred_at: new Date().toISOString(),
          });
          if (!cancelled.ok) throw new Error(cancelled.error.code);
          return { kind: "COMPLETED" };
        },
      },
    });

    await expect(
      runner.runOnce({ scope: authorized.scope, worker_id: "runtime-cancel-worker" }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "CANCELLED_OR_STALE", run_id: command.run_id },
    });
    const projection = await store.readProjection({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    const events = await store.listEvents({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    if (!projection.ok || !projection.value || !events.ok) {
      throw new Error("Cancel projection evidence missing.");
    }
    expect(projection.value.projection.status).toBe("CANCELLED");
    expect(events.value.some(({ event_type }) => event_type === "run.completed")).toBe(false);
  });

  it("deduplicates concurrent identical control commands into one durable Event", async () => {
    const { authorized, command } = await acceptRun("验证并发重复取消只提交一个 Event");
    const store = createPostgresRunEventStore(sqlPool, authority.authorizer, authorized);
    const control = createPostgresRunControl(sqlPool, authority.authorizer, authorized);
    const cancel = {
      schema_version: "1.0.0",
      scope: authorized.scope,
      operation: "CANCEL",
      run_id: command.run_id,
      command_id: randomUUID(),
      event_id: randomUUID(),
      outbox_id: randomUUID(),
      audit_id: randomUUID(),
      idempotency_key: `cancel-concurrent-${randomUUID()}`,
      occurred_at: new Date().toISOString(),
    } as const;

    const [first, second] = await Promise.all([control.submit(cancel), control.submit(cancel)]);
    if (!first.ok || !second.ok) {
      throw new Error(
        `${first.ok ? "OK" : first.error.code}/${second.ok ? "OK" : second.error.code}`,
      );
    }
    expect([first.value.replayed, second.value.replayed].sort()).toEqual([false, true]);
    expect(first.value.projection_hash).toBe(second.value.projection_hash);

    const events = await store.listEvents({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    if (!events.ok) throw new Error(events.error.code);
    expect(
      events.value.filter(({ event_type }) => event_type === "run.cancel_requested"),
    ).toHaveLength(1);
  });

  it("rejects concurrent control replay when the Event identity differs", async () => {
    const { authorized, command } = await acceptRun("验证并发控制重放必须绑定同一个 Event");
    const store = createPostgresRunEventStore(sqlPool, authority.authorizer, authorized);
    const control = createPostgresRunControl(sqlPool, authority.authorizer, authorized);
    const shared = {
      schema_version: "1.0.0",
      scope: authorized.scope,
      operation: "CANCEL",
      run_id: command.run_id,
      command_id: randomUUID(),
      outbox_id: randomUUID(),
      audit_id: randomUUID(),
      idempotency_key: `cancel-conflict-${randomUUID()}`,
      occurred_at: new Date().toISOString(),
    } as const;

    const [first, second] = await Promise.all([
      control.submit({ ...shared, event_id: randomUUID() }),
      control.submit({ ...shared, event_id: randomUUID() }),
    ]);
    const results = [first, second];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "RUN_CONTROL_IDEMPOTENCY_CONFLICT",
          retryable: false,
        }),
      }),
    ]);

    const events = await store.listEvents({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    if (!events.ok) throw new Error(events.error.code);
    expect(
      events.value.filter(({ event_type }) => event_type === "run.cancel_requested"),
    ).toHaveLength(1);
  });

  it("terminal Event commits queue settlement before a later acknowledgement can be lost", async () => {
    const { authorized, command, effectiveConfigLoader } = await acceptRun(
      "验证终态 Event 与 Queue 结算原子提交",
    );
    const queue = createPostgresRunQueue(sqlPool, authority.authorizer, authorized, {
      lease_duration_ms: 10_000,
    });
    const interruptedQueue: RunQueuePort = {
      ...queue,
      async complete() {
        return {
          ok: false,
          error: {
            code: "TEST_ACK_INTERRUPTED",
            message: "测试模拟终态 Event 提交后的进程中断。",
            retryable: true,
          },
        };
      },
    };
    const store = createPostgresRunEventStore(sqlPool, authority.authorizer, authorized);
    const interruptedRunner = createRunWorkerRunner({
      queue: interruptedQueue,
      event_store: store,
      effective_config_loader: effectiveConfigLoader,
      executor: {
        async execute() {
          return { kind: "COMPLETED" };
        },
      },
    });

    await expect(
      interruptedRunner.runOnce({
        scope: authorized.scope,
        worker_id: "runtime-terminal-interrupted",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TEST_ACK_INTERRUPTED" },
    });
    await expect(
      createRunWorkerRunner({
        queue,
        event_store: store,
        effective_config_loader: effectiveConfigLoader,
        executor: {
          async execute() {
            throw new Error("settled work must not execute twice");
          },
        },
      }).runOnce({
        scope: authorized.scope,
        worker_id: "runtime-terminal-reconciler",
      }),
    ).resolves.toEqual({ ok: true, value: { kind: "IDLE" } });

    const persisted = await adminPool.query(
      `select
         run.status as run_status,
         command.status as command_status,
         message.status as outbox_status,
         attempt.status as attempt_status
       from app_data_agent.runs as run
       join app_data_agent.commands as command
         on command.app_id = run.app_id
        and command.tenant_id = run.tenant_id
        and command.environment = run.environment
        and command.run_id = run.run_id
       join app_data_agent.outbox as message
         on message.app_id = command.app_id
        and message.tenant_id = command.tenant_id
        and message.environment = command.environment
        and message.command_id = command.command_id
       join app_data_agent.run_attempts as attempt
         on attempt.app_id = run.app_id
        and attempt.tenant_id = run.tenant_id
        and attempt.environment = run.environment
        and attempt.run_id = run.run_id
       where run.run_id = $1`,
      [command.run_id],
    );
    expect(persisted.rows[0]).toEqual({
      run_status: "SUCCEEDED",
      command_status: "SUCCEEDED",
      outbox_status: "PUBLISHED",
      attempt_status: "SUCCEEDED",
    });
  });

  it("propagates the database-authoritative Snapshot Hash through suspend and resume", async () => {
    const { authorized, command, effectiveConfigLoader } = await acceptRun(
      "验证 Suspend/Resume 从持久 Snapshot 恢复",
    );
    const queue = createPostgresRunQueue(sqlPool, authority.authorizer, authorized, {
      lease_duration_ms: 10_000,
    });
    const store = createPostgresRunEventStore(sqlPool, authority.authorizer, authorized);
    const control = createPostgresRunControl(sqlPool, authority.authorizer, authorized);
    let executions = 0;
    let restoredSnapshotId: string | null = null;
    let restoredSnapshotHash: string | null = null;
    const runner = createRunWorkerRunner({
      queue,
      event_store: store,
      effective_config_loader: effectiveConfigLoader,
      executor: {
        async execute({ restored_snapshot }) {
          executions += 1;
          if (executions === 1) {
            return {
              kind: "SUSPENDED",
              reason_code: "WAITING_FOR_CLARIFICATION",
              checkpoint: {
                workflow_id: "l2-research@1.0.0",
                workflow_definition_revision: `sha256:${"2".repeat(64)}`,
                mastra_run_id: `mastra-${command.run_id}`,
                snapshot_version: 1,
                active_artifact_ref: null,
                mastra_snapshot: {
                  runId: `mastra-${command.run_id}`,
                  status: "suspended",
                  state: {
                    next_step: "clarification",
                    exponent_float: 1e-7,
                    shortest_decimal_tie: 140751465587434200,
                    "\u{10000}": "supplementary",
                    "\uE000": "bmp",
                  },
                },
              },
            };
          }
          restoredSnapshotId = restored_snapshot?.snapshot_id ?? null;
          restoredSnapshotHash = restored_snapshot?.snapshot_hash ?? null;
          return { kind: "COMPLETED" };
        },
      },
    });

    const suspended = await runner.runOnce({
      scope: authorized.scope,
      worker_id: "runtime-suspend-worker",
    });
    if (!suspended.ok) {
      throw new Error(`${suspended.error.code}: ${suspended.error.message}`);
    }
    expect(suspended).toMatchObject({
      ok: true,
      value: { kind: "SUSPENDED", run_id: command.run_id },
    });

    const committedSnapshot = await store.loadLatestSnapshot({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    const suspendedEvents = await store.listEvents({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    if (!committedSnapshot.ok || !committedSnapshot.value || !suspendedEvents.ok) {
      throw new Error("Committed adversarial Snapshot evidence missing.");
    }
    const { snapshot_hash: authoritativeSnapshotHash, ...committedSnapshotBody } =
      committedSnapshot.value;
    expect(committedSnapshot.value.mastra_snapshot).toMatchObject({
      state: {
        exponent_float: 1e-7,
        shortest_decimal_tie: 140751465587434200,
        "\u{10000}": "supplementary",
        "\uE000": "bmp",
      },
    });
    await expect(computeMastraSnapshotBindingHash(committedSnapshotBody)).resolves.not.toBe(
      authoritativeSnapshotHash,
    );
    expect(
      suspendedEvents.value.find(({ event_type }) => event_type === "run.checkpointed"),
    ).toMatchObject({
      payload: {
        snapshot_ref: {
          snapshot_hash: authoritativeSnapshotHash,
        },
      },
    });

    const resumed = await control.submit({
      schema_version: "1.0.0",
      scope: authorized.scope,
      operation: "RESUME",
      run_id: command.run_id,
      command_id: randomUUID(),
      event_id: randomUUID(),
      outbox_id: randomUUID(),
      audit_id: randomUUID(),
      idempotency_key: `resume-${randomUUID()}`,
      occurred_at: new Date().toISOString(),
    });
    if (!resumed.ok) throw new Error(`${resumed.error.code}: ${resumed.error.message}`);
    expect(resumed.value.projection.status).toBe("QUEUED");

    await expect(
      runner.runOnce({ scope: authorized.scope, worker_id: "runtime-resume-worker" }),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", run_id: command.run_id },
    });

    expect(executions).toBe(2);
    expect(restoredSnapshotId).not.toBeNull();
    expect(restoredSnapshotHash).toBe(authoritativeSnapshotHash);
    const projection = await store.readProjection({
      scope: authorized.scope,
      run_id: command.run_id,
    });
    if (!projection.ok || !projection.value) throw new Error("Resume projection missing.");
    expect(projection.value.projection).toMatchObject({
      status: "COMPLETED",
      attempt_count: 2,
      worker_fence: 2,
    });
  });

  it("Heartbeat prevents a second Worker from taking over the active Run", async () => {
    const { authorized } = await acceptRun("验证 Heartbeat 延长 PostgreSQL Lease");
    const queue = createPostgresRunQueue(sqlPool, authority.authorizer, authorized, {
      lease_duration_ms: 5_000,
    });
    const first = await queue.lease({
      scope: authorized.scope,
      worker_id: "runtime-heartbeat-a",
    });
    if (!first.ok || !first.value) {
      throw new Error(`Heartbeat lease missing: ${JSON.stringify(first)}`);
    }

    await expect(queue.heartbeat({ lease: first.value })).resolves.toMatchObject({
      ok: true,
      value: { expires_at: expect.any(String) },
    });
    await expect(
      queue.lease({
        scope: authorized.scope,
        worker_id: "runtime-heartbeat-b",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });
});
