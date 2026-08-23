import {
  hashRunProjection,
  reduceRunProjection,
  runRuntimeEventSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresRunControl } from "../../src/events/postgres-run-control.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  run: "00000000-0000-4000-8000-000000000201",
  commandStart: "00000000-0000-4000-8000-000000000301",
  commandCancel: "00000000-0000-4000-8000-000000000302",
  commandResume: "00000000-0000-4000-8000-000000000303",
  eventAccepted: "00000000-0000-4000-8000-000000000401",
  eventLeased: "00000000-0000-4000-8000-000000000402",
  eventCancel: "00000000-0000-4000-8000-000000000403",
  eventResume: "00000000-0000-4000-8000-000000000404",
  eventCompleted: "00000000-0000-4000-8000-000000000405",
  outbox: "00000000-0000-4000-8000-000000000501",
  otherOutbox: "00000000-0000-4000-8000-000000000502",
  audit: "00000000-0000-4000-8000-000000000601",
  otherAudit: "00000000-0000-4000-8000-000000000602",
  deployment: "00000000-0000-4000-8000-0000000000d1",
} as const;
const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "test" } as const;
const payloadHash = `sha256:${"a".repeat(64)}`;

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

function acceptedProjection() {
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
    payload: { command_id: ids.commandStart, payload_hash: payloadHash },
  });
  return reduceRunProjection(null, accepted);
}

function runningProjection() {
  return reduceRunProjection(acceptedProjection(), {
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
      command_id: ids.commandStart,
      lease_id: "lease-1",
      worker_id: "worker-a",
      attempt: 1,
    },
  });
}

function completedProjection() {
  const running = runningProjection();
  return reduceRunProjection(running, {
    schema_version: "1.0.0",
    event_id: ids.eventCompleted,
    scope,
    run_id: ids.run,
    sequence: running.version + 1,
    worker_fence: running.worker_fence,
    idempotency_key: `event:${ids.eventCompleted}`,
    occurred_at: "2026-07-25T00:00:02.000Z",
    event_type: "run.completed",
    payload: { completion_kind: "WORKFLOW_EXECUTION_ONLY" },
  });
}

describe("PostgreSQL Run Control", () => {
  it("CANCEL atomically raises the Fence and projects CANCELLED", async () => {
    const projection = runningProjection();
    const projectionHash = await hashRunProjection(projection);
    const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
        calls.push({ text, values });
        if (text.includes("backend_context_matches")) {
          return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
        }
        if (text.includes("from run_projections")) {
          return {
            rows: [
              {
                projection_json: projection,
                projection_hash: projectionHash,
                active_fence: 1,
                existing_event: null,
              },
            ],
            rowCount: 1,
          } as unknown as SqlQueryResult<Row>;
        }
        if (text.includes("request_run_control")) {
          const committedProjection = JSON.parse(String(values[4]));
          return {
            rows: [
              {
                result: {
                  replayed: false,
                  command_id: ids.commandCancel,
                  event_id: ids.eventCancel,
                  event_hash: values[2],
                  outbox_id: ids.outbox,
                  audit_id: ids.audit,
                  projection: committedProjection,
                  projection_hash: values[5],
                },
              },
            ],
            rowCount: 1,
          } as unknown as SqlQueryResult<Row>;
        }
        return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
      },
      release() {},
    };
    const pool: SqlPool = { connect: async () => client };
    const authority = issueCapability();
    const control = createPostgresRunControl(pool, authority.authorizer, authority.capability);

    const result = await control.submit({
      schema_version: "1.0.0",
      scope,
      operation: "CANCEL",
      run_id: ids.run,
      command_id: ids.commandCancel,
      event_id: ids.eventCancel,
      outbox_id: ids.outbox,
      audit_id: ids.audit,
      idempotency_key: "cancel-once",
      occurred_at: "2026-07-25T00:00:02.000Z",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        replayed: false,
        command_id: ids.commandCancel,
        projection: {
          status: "CANCELLED",
          worker_fence: 2,
          version: 3,
          terminal_event_id: ids.eventCancel,
        },
      },
    });
    const request = calls.find(({ text }) => text.includes("request_run_control"));
    expect(request?.values).toHaveLength(6);
    expect(JSON.parse(String(request?.values[1]))).toMatchObject({
      event_type: "run.cancel_requested",
      worker_fence: 2,
    });
    expect(request?.values[3]).toBe(projectionHash);
    const stateRead = calls.find(({ text }) => text.includes("from run_projections"));
    expect(stateRead?.text).toContain("event.event_document");
    expect(stateRead?.text).toContain("existing.outbox_id");
    expect(stateRead?.text).toContain("existing.audit_id");
  });

  it("uses the authoritative Run Fence when cancelling after claim but before run.leased", async () => {
    const projection = acceptedProjection();
    const projectionHash = await hashRunProjection(projection);
    let submittedEvent: Record<string, unknown> | undefined;
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
        if (text.includes("backend_context_matches")) {
          return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
        }
        if (text.includes("from run_projections")) {
          return {
            rows: [
              {
                projection_json: projection,
                projection_hash: projectionHash,
                active_fence: 1,
                existing_event: null,
              },
            ],
            rowCount: 1,
          } as unknown as SqlQueryResult<Row>;
        }
        if (text.includes("request_run_control")) {
          submittedEvent = JSON.parse(String(values[1])) as Record<string, unknown>;
          return {
            rows: [
              {
                result: {
                  replayed: false,
                  command_id: ids.commandCancel,
                  event_id: ids.eventCancel,
                  event_hash: values[2],
                  outbox_id: ids.outbox,
                  audit_id: ids.audit,
                  projection: JSON.parse(String(values[4])),
                  projection_hash: values[5],
                },
              },
            ],
            rowCount: 1,
          } as unknown as SqlQueryResult<Row>;
        }
        return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
      },
      release() {},
    };
    const authority = issueCapability();
    const control = createPostgresRunControl(
      { connect: async () => client },
      authority.authorizer,
      authority.capability,
    );

    const result = await control.submit({
      schema_version: "1.0.0",
      scope,
      operation: "CANCEL",
      run_id: ids.run,
      command_id: ids.commandCancel,
      event_id: ids.eventCancel,
      outbox_id: ids.outbox,
      audit_id: ids.audit,
      idempotency_key: "cancel-claim-gap",
      occurred_at: "2026-07-25T00:00:02.000Z",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        projection: { status: "CANCELLED", worker_fence: 2 },
      },
    });
    expect(submittedEvent).toMatchObject({
      event_type: "run.cancel_requested",
      worker_fence: 2,
    });
  });

  it("replays an identical control Event from the same atomic state read", async () => {
    const current = runningProjection();
    const cancelEvent = runRuntimeEventSchema.parse({
      schema_version: "1.0.0",
      event_id: ids.eventCancel,
      scope,
      run_id: ids.run,
      sequence: current.version + 1,
      worker_fence: current.worker_fence + 1,
      idempotency_key: "cancel-once",
      occurred_at: "2026-07-25T00:00:02.000Z",
      event_type: "run.cancel_requested",
      payload: { command_id: ids.commandCancel },
    });
    const projection = reduceRunProjection(current, cancelEvent);
    const projectionHash = await hashRunProjection(projection);
    const calls: string[] = [];
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string) {
        calls.push(text);
        if (text.includes("backend_context_matches")) {
          return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
        }
        if (text.includes("from run_projections")) {
          return {
            rows: [
              {
                projection_json: projection,
                projection_hash: projectionHash,
                active_fence: projection.worker_fence,
                existing_event: cancelEvent,
                existing_outbox_id: ids.outbox,
                existing_audit_id: ids.audit,
              },
            ],
            rowCount: 1,
          } as unknown as SqlQueryResult<Row>;
        }
        return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
      },
      release() {},
    };
    const authority = issueCapability();
    const control = createPostgresRunControl(
      { connect: async () => client },
      authority.authorizer,
      authority.capability,
    );

    await expect(
      control.submit({
        schema_version: "1.0.0",
        scope,
        operation: "CANCEL",
        run_id: ids.run,
        command_id: ids.commandCancel,
        event_id: ids.eventCancel,
        outbox_id: ids.outbox,
        audit_id: ids.audit,
        idempotency_key: "cancel-once",
        occurred_at: "2026-07-25T00:00:02.000Z",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        replayed: true,
        command_id: ids.commandCancel,
        projection,
        projection_hash: projectionHash,
      },
    });
    for (const changedIdentity of [{ outbox_id: ids.otherOutbox }, { audit_id: ids.otherAudit }]) {
      await expect(
        control.submit({
          schema_version: "1.0.0",
          scope,
          operation: "CANCEL",
          run_id: ids.run,
          command_id: ids.commandCancel,
          event_id: ids.eventCancel,
          outbox_id: ids.outbox,
          audit_id: ids.audit,
          idempotency_key: "cancel-once",
          occurred_at: "2026-07-25T00:00:02.000Z",
          ...changedIdentity,
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "RUN_CONTROL_IDEMPOTENCY_CONFLICT", retryable: false },
      });
    }
    await expect(
      control.submit({
        schema_version: "1.0.0",
        scope,
        operation: "CANCEL",
        run_id: ids.run,
        command_id: ids.commandCancel,
        event_id: ids.eventCancel,
        outbox_id: ids.outbox,
        audit_id: ids.audit,
        idempotency_key: "cancel-once",
        occurred_at: "2026-07-25T00:00:03.000Z",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_CONTROL_IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(calls.some((text) => text.includes("request_run_control"))).toBe(false);
  });

  it("does not call the SECURITY DEFINER control RPC when RLS hides a downgraded owner's Run", async () => {
    const calls: string[] = [];
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string) {
        calls.push(text);
        if (text.includes("backend_context_matches")) {
          return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
        }
        return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
      },
      release() {},
    };
    const authority = issueCapability();
    const control = createPostgresRunControl(
      { connect: async () => client },
      authority.authorizer,
      authority.capability,
    );

    await expect(
      control.submit({
        schema_version: "1.0.0",
        scope,
        operation: "RESUME",
        run_id: ids.run,
        command_id: ids.commandResume,
        event_id: ids.eventResume,
        outbox_id: ids.outbox,
        audit_id: ids.audit,
        idempotency_key: "resume-before-downgrade",
        occurred_at: "2026-07-25T00:00:03.000Z",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_CONTROL_RUN_NOT_FOUND", retryable: false },
    });
    expect(calls.some((text) => text.includes("request_run_control"))).toBe(false);
    expect(calls.at(-1)).toBe("ROLLBACK");
  });

  it.each([
    {
      transition: "QUEUED -> RESUME",
      projection: acceptedProjection(),
      activeFence: 0,
      operation: "RESUME" as const,
      commandId: ids.commandResume,
      eventId: ids.eventResume,
      idempotencyKey: "resume-invalid",
    },
    {
      transition: "COMPLETED -> CANCEL",
      projection: completedProjection(),
      activeFence: 1,
      operation: "CANCEL" as const,
      commandId: ids.commandCancel,
      eventId: ids.eventCancel,
      idempotencyKey: "cancel-completed",
    },
  ])("maps an invalid $transition transition to a stable control error", async (fixture) => {
    const projectionHash = await hashRunProjection(fixture.projection);
    const calls: string[] = [];
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string) {
        calls.push(text);
        if (text.includes("backend_context_matches")) {
          return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
        }
        if (text.includes("from run_projections")) {
          return {
            rows: [
              {
                projection_json: fixture.projection,
                projection_hash: projectionHash,
                active_fence: fixture.activeFence,
                existing_event: null,
              },
            ],
            rowCount: 1,
          } as unknown as SqlQueryResult<Row>;
        }
        return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
      },
      release() {},
    };
    const authority = issueCapability();
    const control = createPostgresRunControl(
      { connect: async () => client },
      authority.authorizer,
      authority.capability,
    );

    await expect(
      control.submit({
        schema_version: "1.0.0",
        scope,
        operation: fixture.operation,
        run_id: ids.run,
        command_id: fixture.commandId,
        event_id: fixture.eventId,
        outbox_id: ids.outbox,
        audit_id: ids.audit,
        idempotency_key: fixture.idempotencyKey,
        occurred_at: "2026-07-25T00:00:03.000Z",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RUN_CONTROL_STATE_INVALID", retryable: false },
    });
    expect(calls.some((text) => text.includes("request_run_control"))).toBe(false);
    expect(calls.at(-1)).toBe("ROLLBACK");
  });
});
