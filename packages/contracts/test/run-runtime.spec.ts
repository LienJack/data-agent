import { describe, expect, it } from "vitest";
import { canonicalizeJson, sha256ContentHash } from "../src/common/index.js";
import {
  computeMastraSnapshotBindingHash,
  hashRunProjection,
  mastraSnapshotBindingSchema,
  reduceRunProjection,
  replayRunProjection,
  retryDelayMsSchema,
  runRuntimeEventSchema,
  runtimeTimestampSchema,
  runWorkLeaseSchema,
  sideEffectReceiptSchema,
  workerRunRuntimeEventSchema,
} from "../src/runs/index.js";
import { environments, hashes, ids, makeArtifactReference } from "./fixtures.js";

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: environments.test,
} as const;

const eventIds = {
  accepted: "00000000-0000-4000-8000-000000000101",
  leased: "00000000-0000-4000-8000-000000000102",
  effect: "00000000-0000-4000-8000-000000000103",
  suspended: "00000000-0000-4000-8000-000000000104",
  resumed: "00000000-0000-4000-8000-000000000105",
  reLeased: "00000000-0000-4000-8000-000000000106",
  completed: "00000000-0000-4000-8000-000000000107",
  cancel: "00000000-0000-4000-8000-000000000108",
} as const;

const occurredAt = "2026-07-25T12:00:00.000Z";

function event(
  input:
    | {
        readonly event_id: string;
        readonly event_type: "run.accepted";
        readonly sequence: number;
        readonly worker_fence: number;
        readonly payload: {
          readonly command_id: string;
          readonly payload_hash: string;
        };
      }
    | {
        readonly event_id: string;
        readonly event_type: "run.leased";
        readonly sequence: number;
        readonly worker_fence: number;
        readonly payload: {
          readonly command_id: string;
          readonly lease_id: string;
          readonly worker_id: string;
          readonly attempt: number;
        };
      }
    | {
        readonly event_id: string;
        readonly event_type: "run.side_effect_committed";
        readonly sequence: number;
        readonly worker_fence: number;
        readonly payload: {
          readonly receipt_id: string;
          readonly effect_kind: "SQL" | "EVAL";
          readonly input_hash: string;
          readonly output_hash: string;
        };
      }
    | {
        readonly event_id: string;
        readonly event_type: "run.suspended";
        readonly sequence: number;
        readonly worker_fence: number;
        readonly payload: {
          readonly reason_code: string;
          readonly snapshot_id: string;
        };
      }
    | {
        readonly event_id: string;
        readonly event_type: "run.resumed";
        readonly sequence: number;
        readonly worker_fence: number;
        readonly payload: { readonly command_id: string };
      }
    | {
        readonly event_id: string;
        readonly event_type: "run.completed";
        readonly sequence: number;
        readonly worker_fence: number;
        readonly payload: { readonly completion_kind: "WORKFLOW_EXECUTION_ONLY" };
      }
    | {
        readonly event_id: string;
        readonly event_type: "run.cancel_requested";
        readonly sequence: number;
        readonly worker_fence: number;
        readonly payload: { readonly command_id: string };
      },
) {
  return runRuntimeEventSchema.parse({
    schema_version: "1.0.0",
    scope,
    run_id: ids.run,
    idempotency_key: `event:${input.event_id}`,
    occurred_at: occurredAt,
    ...input,
  });
}

function acceptedEvent() {
  return event({
    event_id: eventIds.accepted,
    event_type: "run.accepted",
    sequence: 1,
    worker_fence: 0,
    payload: {
      command_id: ids.command,
      payload_hash: hashes.execution,
    },
  });
}

function leasedEvent(sequence = 2, workerFence = 1, eventId: string = eventIds.leased) {
  return event({
    event_id: eventId,
    event_type: "run.leased",
    sequence,
    worker_fence: workerFence,
    payload: {
      command_id: ids.command,
      lease_id: `lease-${workerFence}`,
      worker_id: "worker-a",
      attempt: workerFence,
    },
  });
}

describe("持久 Run Runtime Contract", () => {
  it("固定 TypeScript Canonical JSON 的指数数字与 UTF-16 Key 排序", async () => {
    const fixture = {
      n: 1e-7,
      "\u{10000}": "supplementary",
      "\uE000": "bmp",
    };

    expect(canonicalizeJson(fixture)).toBe('{"n":1e-7,"𐀀":"supplementary","":"bmp"}');
    await expect(sha256ContentHash(fixture)).resolves.toBe(
      "sha256:dc67784b5dab2ea74956f3c1c916cf497cfcc2895565d16ef2138dceb8e951ac",
    );
  });

  it("固定 TypeScript Canonical JSON 的 JavaScript Number 边界", () => {
    const fixtures = [
      [1e-6, '{"n":0.000001}'],
      [1e-7, '{"n":1e-7}'],
      [1e20, '{"n":100000000000000000000}'],
      [1e21, '{"n":1e+21}'],
      [-0, '{"n":0}'],
      [Number("9007199254740993"), '{"n":9007199254740992}'],
      [Number("1.234567890123456789"), '{"n":1.2345678901234567}'],
      [0.30000000000000004, '{"n":0.30000000000000004}'],
      [Number.MIN_VALUE, '{"n":5e-324}'],
      [Number.MAX_VALUE, '{"n":1.7976931348623157e+308}'],
      [140751465587434200, '{"n":140751465587434200}'],
    ] as const;

    for (const [value, canonical] of fixtures) {
      expect(canonicalizeJson({ n: value })).toBe(canonical);
    }
  });

  it("Worker Append 面只接受执行事件，并统一使用 PostgreSQL UTC 毫秒时间", () => {
    expect(workerRunRuntimeEventSchema.safeParse(acceptedEvent()).success).toBe(false);
    expect(workerRunRuntimeEventSchema.safeParse(leasedEvent()).success).toBe(true);
    expect(runtimeTimestampSchema.safeParse("2026-07-25T12:00:00.000Z").success).toBe(true);
    expect(runtimeTimestampSchema.safeParse("2026-07-25T12:00:00Z").success).toBe(false);
    expect(runtimeTimestampSchema.safeParse("2026-07-25T20:00:00.000+08:00").success).toBe(false);
    expect(runtimeTimestampSchema.safeParse("2026-07-25T12:00:00.000001Z").success).toBe(false);
  });

  it("Retry 只接受有限的数据库签发延迟，不接受调用方绝对时间", () => {
    expect(retryDelayMsSchema.safeParse(0).success).toBe(false);
    expect(retryDelayMsSchema.safeParse(1_000).success).toBe(true);
    expect(retryDelayMsSchema.safeParse(86_400_000).success).toBe(true);
    expect(retryDelayMsSchema.safeParse(86_400_001).success).toBe(false);
    expect(retryDelayMsSchema.safeParse("2026-07-25T12:00:00.000Z").success).toBe(false);
  });

  it("Lease 区分 Run 全局 Attempt 与当前 Outbox 的交付预算", () => {
    const lease = {
      scope,
      principal_id: "00000000-0000-4000-8000-000000000016",
      outbox_id: "00000000-0000-4000-8000-000000000015",
      run_id: ids.run,
      command_id: ids.command,
      command_kind: "RESUME_RUN",
      attempt_id: ids.attempt,
      attempt_no: 6,
      delivery_attempt_no: 1,
      lease_duration_ms: 30_000,
      worker_id: "worker-resume",
      lease_token: 6,
      worker_fence: 6,
      expires_at: "2026-07-25T12:01:00.000Z",
      payload: { kind: "RESUME_RUN" },
    } as const;

    expect(runWorkLeaseSchema.safeParse(lease).success).toBe(true);
    expect(
      runWorkLeaseSchema.safeParse({
        ...lease,
        delivery_attempt_no: 0,
      }).success,
    ).toBe(false);
    expect(
      runWorkLeaseSchema.safeParse({
        ...lease,
        lease_duration_ms: 4_999,
      }).success,
    ).toBe(false);
    const { delivery_attempt_no: _omitted, ...withoutBudget } = lease;
    expect(runWorkLeaseSchema.safeParse(withoutBudget).success).toBe(false);
  });

  it("从 Durable Event 唯一重建 Projection，Live 与 Replay Hash 一致", async () => {
    const events = [
      acceptedEvent(),
      leasedEvent(),
      event({
        event_id: eventIds.effect,
        event_type: "run.side_effect_committed",
        sequence: 3,
        worker_fence: 1,
        payload: {
          receipt_id: ids.receipt,
          effect_kind: "SQL",
          input_hash: hashes.input,
          output_hash: hashes.execution,
        },
      }),
      event({
        event_id: eventIds.suspended,
        event_type: "run.suspended",
        sequence: 4,
        worker_fence: 1,
        payload: {
          reason_code: "WAITING_FOR_CLARIFICATION",
          snapshot_id: ids.snapshot,
        },
      }),
      event({
        event_id: eventIds.resumed,
        event_type: "run.resumed",
        sequence: 5,
        worker_fence: 1,
        payload: { command_id: ids.assignment },
      }),
      leasedEvent(6, 2, eventIds.reLeased),
      event({
        event_id: eventIds.completed,
        event_type: "run.completed",
        sequence: 7,
        worker_fence: 2,
        payload: { completion_kind: "WORKFLOW_EXECUTION_ONLY" },
      }),
    ];

    let live = null;
    for (const nextEvent of events) {
      live = reduceRunProjection(live, nextEvent);
    }
    const replayed = replayRunProjection(events);

    expect(live).toEqual(replayed);
    expect(replayed).toMatchObject({
      status: "COMPLETED",
      version: 7,
      worker_fence: 2,
      attempt_count: 2,
      last_event_id: eventIds.completed,
    });
    await expect(hashRunProjection(live)).resolves.toBe(await hashRunProjection(replayed));
  });

  it("取消会提高 Fence 并拒绝迟到 Success、Checkpoint 与旧 Worker", () => {
    const running = reduceRunProjection(reduceRunProjection(null, acceptedEvent()), leasedEvent());
    const cancelled = reduceRunProjection(
      running,
      event({
        event_id: eventIds.cancel,
        event_type: "run.cancel_requested",
        sequence: 3,
        worker_fence: 2,
        payload: { command_id: ids.assignment },
      }),
    );

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.worker_fence).toBe(2);
    expect(() =>
      reduceRunProjection(
        cancelled,
        event({
          event_id: eventIds.completed,
          event_type: "run.completed",
          sequence: 4,
          worker_fence: 1,
          payload: { completion_kind: "WORKFLOW_EXECUTION_ONLY" },
        }),
      ),
    ).toThrow(/终态|Fence/);
    expect(() => reduceRunProjection(running, leasedEvent(3, 1, eventIds.reLeased))).toThrow(
      /Fence/,
    );
  });

  it("Worker 崩溃后允许过期 Lease 用更高 Fence 接管 RUNNING Projection", () => {
    const running = reduceRunProjection(reduceRunProjection(null, acceptedEvent()), leasedEvent());
    const takenOver = reduceRunProjection(running, leasedEvent(3, 2, eventIds.reLeased));

    expect(takenOver).toMatchObject({
      status: "RUNNING",
      worker_fence: 2,
      attempt_count: 2,
      last_event_id: eventIds.reLeased,
    });
  });

  it("Claim 后、run.leased 前崩溃时保留数据库 Attempt 编号", () => {
    const accepted = reduceRunProjection(null, acceptedEvent());
    const recovered = reduceRunProjection(accepted, leasedEvent(2, 2));

    expect(recovered.attempt_count).toBe(2);
    expect(() =>
      reduceRunProjection(recovered, {
        ...leasedEvent(3, 3, eventIds.reLeased),
        payload: {
          ...leasedEvent(3, 3, eventIds.reLeased).payload,
          attempt: 2,
        },
      }),
    ).toThrow(/Attempt/);
  });

  it("Mastra Snapshot 只作为绑定 Event、Fence 与 Active Artifact 的非权威快照", async () => {
    const activeArtifact = makeArtifactReference("ResearchBrief");
    const body = {
      schema_version: "1.0.0",
      authority: "EXECUTION_SNAPSHOT_ONLY",
      snapshot_id: ids.snapshot,
      scope,
      run_id: ids.run,
      workflow_id: "l2-research",
      workflow_definition_revision: hashes.artifact,
      mastra_core_version: "1.52.1",
      mastra_run_id: "mastra-run-1",
      attempt_id: ids.attempt,
      snapshot_version: 1,
      event_sequence: 2,
      worker_fence: 1,
      active_artifact_ref: activeArtifact,
      mastra_snapshot: {
        runId: "mastra-run-1",
        status: "suspended",
        timestamp: 1,
      },
      created_at: occurredAt,
    } as const;
    const snapshotHash = await computeMastraSnapshotBindingHash(body);
    const binding = mastraSnapshotBindingSchema.parse({
      ...body,
      snapshot_hash: snapshotHash,
    });

    expect(binding.authority).toBe("EXECUTION_SNAPSHOT_ONLY");
    expect(
      mastraSnapshotBindingSchema.safeParse({
        ...binding,
        mastra_snapshot: { ...binding.mastra_snapshot, runId: "other-run" },
      }).success,
    ).toBe(false);
    expect(
      mastraSnapshotBindingSchema.safeParse({
        ...binding,
        active_artifact_ref: {
          ...activeArtifact,
          run_id: ids.assignment,
        },
      }).success,
    ).toBe(false);
  });

  it("Side Effect Receipt 用输入内容寻址，并绑定当前 Worker Fence", () => {
    const receipt = sideEffectReceiptSchema.parse({
      schema_version: "1.0.0",
      receipt_id: ids.receipt,
      scope,
      run_id: ids.run,
      effect_kind: "SQL",
      input_hash: hashes.input,
      output_hash: hashes.execution,
      worker_fence: 4,
      committed_at: occurredAt,
    });

    expect(receipt).toMatchObject({
      effect_kind: "SQL",
      input_hash: hashes.input,
      worker_fence: 4,
    });
    expect(
      sideEffectReceiptSchema.safeParse({
        ...receipt,
        input_hash: "not-content-addressed",
      }).success,
    ).toBe(false);
  });
});
