import {
  type AppScope,
  type ContractError,
  runCheckpointInputSchema as contractRunCheckpointInputSchema,
  type MastraSnapshotBinding,
  mastraSnapshotBindingSchema,
  type PortResult,
  RUN_RETRY_MAX_ATTEMPTS,
  RUN_RETRY_MIN_DELAY_MS,
  type RunEventStorePort,
  type RunProjectionRecord,
  type RunQueuePort,
  type RunRuntimeEvent,
  type RunWorkLease,
  retryDelayMsSchema,
  runWorkLeaseSchema,
  type SideEffectReceipt,
  workerRunRuntimeEventSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { createRunExecutionContext } from "./run-execution-context.js";
import { createRunExecutionSupervisor } from "./run-execution-supervisor.js";
import { failure, occurredAt, scopesMatch, success } from "./run-worker-shared.js";

const stableReasonCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const runCheckpointInputSchema = contractRunCheckpointInputSchema;

export const runExecutorResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("COMPLETED"),
  }),
  z.strictObject({
    kind: z.literal("SUSPENDED"),
    reason_code: stableReasonCodeSchema,
    checkpoint: runCheckpointInputSchema,
  }),
  z.strictObject({
    kind: z.literal("RETRY"),
    error_code: stableReasonCodeSchema,
    retry_delay_ms: retryDelayMsSchema,
  }),
  z.strictObject({
    kind: z.literal("FAILED"),
    error_code: stableReasonCodeSchema,
  }),
]);

export type RunCheckpointInput = z.infer<typeof runCheckpointInputSchema>;
export type RunExecutorResult = z.infer<typeof runExecutorResultSchema>;

export interface RunSideEffectExecutionIdentity {
  readonly idempotency_key: string;
  readonly input_hash: string;
  readonly signal: AbortSignal;
  readonly deadline_at: string;
}

export type RunWorkerCycleOutcome =
  | Readonly<{ kind: "IDLE" }>
  | Readonly<{
      kind: "COMPLETED" | "FAILED" | "RETRY_SCHEDULED" | "SUSPENDED";
      run_id: string;
      final_event_sequence: number;
    }>
  | Readonly<{
      kind: "TERMINAL_RECONCILED";
      run_id: string;
      final_event_sequence: number;
    }>
  | Readonly<{
      kind: "CANCELLED_OR_STALE";
      run_id: string;
      observed_event_sequence: number;
    }>;

export interface RunExecutionContext {
  heartbeat(): Promise<PortResult<{ readonly expires_at: string }>>;
  checkpoint(input: RunCheckpointInput): Promise<PortResult<MastraSnapshotBinding>>;
  executeSideEffectOnce(input: {
    readonly effect_kind: SideEffectReceipt["effect_kind"];
    readonly input: unknown;
    readonly execute: (identity: RunSideEffectExecutionIdentity) => Promise<
      Readonly<{
        output: unknown;
        artifact_ref?: SideEffectReceipt["artifact_ref"];
      }>
    >;
  }): Promise<PortResult<SideEffectReceipt>>;
}

export interface RunWorkflowExecutorPort {
  execute(input: {
    readonly lease: RunWorkLease;
    readonly restored_snapshot: MastraSnapshotBinding | null;
    readonly context: RunExecutionContext;
    readonly signal: AbortSignal;
    readonly deadline_at: string;
  }): Promise<RunExecutorResult>;
}

export interface RunWorkerRunner {
  runOnce(input: {
    readonly scope: AppScope;
    readonly worker_id: string;
  }): Promise<PortResult<RunWorkerCycleOutcome>>;
}

export interface RunWorkerRunnerDependencies {
  readonly queue: RunQueuePort;
  readonly event_store: RunEventStorePort;
  readonly executor: RunWorkflowExecutorPort;
  readonly now?: () => Date;
  readonly create_id?: () => string;
  readonly execution_timeout_ms?: number;
  readonly heartbeat_interval_ms?: number;
  readonly side_effect_timeout_ms?: number;
}

type AppendResult = Readonly<{
  event: RunRuntimeEvent;
  projection: RunProjectionRecord;
}>;

const workerRuntimeTimingSchema = z
  .strictObject({
    execution_timeout_ms: z.number().int().min(10).max(3_600_000),
    heartbeat_interval_ms: z.number().int().min(10).max(300_000),
    side_effect_timeout_ms: z.number().int().min(10).max(900_000),
  })
  .refine(
    ({ execution_timeout_ms, heartbeat_interval_ms }) =>
      heartbeat_interval_ms < execution_timeout_ms,
    "Heartbeat Interval 必须小于总执行超时。",
  );

function staleCommitFailure<T>(record: RunProjectionRecord, lease: RunWorkLease): PortResult<T> {
  return failure(
    "RUN_COMMIT_CANCELLED_OR_STALE",
    "Run 已取消、进入终态或 Worker Fence 已过期，拒绝迟到提交。",
    false,
    {
      run_id: lease.run_id,
      observed_status: record.projection.status,
      observed_event_sequence: record.projection.version,
      observed_worker_fence: record.projection.worker_fence,
      lease_worker_fence: lease.worker_fence,
    },
  );
}

function staleOutcome(
  lease: RunWorkLease,
  record: RunProjectionRecord,
): PortResult<RunWorkerCycleOutcome> {
  return success({
    kind: "CANCELLED_OR_STALE",
    run_id: lease.run_id,
    observed_event_sequence: record.projection.version,
  });
}

function defaultIdFactory(): string {
  return crypto.randomUUID();
}

function eventIdempotencyKey(lease: RunWorkLease, eventKind: string, identity: string): string {
  return [eventKind, lease.outbox_id, identity].join(":");
}

function sideEffectEventIdempotencyKey(lease: RunWorkLease, receipt: SideEffectReceipt): string {
  return ["side-effect", lease.run_id, receipt.effect_kind, receipt.input_hash].join(":");
}

function processCrashFailure(): PortResult<RunWorkerCycleOutcome> {
  return failure(
    "WORKER_PROCESS_CRASH",
    "Worker 执行意外中断；Lease 保持未确认并等待过期接管。",
    true,
  );
}

export function createRunWorkerRunner(dependencies: RunWorkerRunnerDependencies): RunWorkerRunner {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.create_id ?? defaultIdFactory;
  const timing = workerRuntimeTimingSchema.parse({
    execution_timeout_ms: dependencies.execution_timeout_ms ?? 300_000,
    heartbeat_interval_ms: dependencies.heartbeat_interval_ms ?? 15_000,
    side_effect_timeout_ms: dependencies.side_effect_timeout_ms ?? 60_000,
  });

  async function readProjection(lease: RunWorkLease): Promise<PortResult<RunProjectionRecord>> {
    const result = await dependencies.event_store.readProjection({
      scope: lease.scope,
      run_id: lease.run_id,
    });
    if (!result.ok) {
      return result;
    }
    if (!result.value) {
      return failure("RUN_PROJECTION_NOT_FOUND", "Lease 对应的 Run Projection 不存在。", false);
    }
    return success(result.value);
  }

  async function guardRunningLease(
    lease: RunWorkLease,
    expectedProjectionHash?: string,
  ): Promise<PortResult<RunProjectionRecord>> {
    const current = await readProjection(lease);
    if (!current.ok) {
      return current;
    }
    if (
      current.value.projection.status !== "RUNNING" ||
      current.value.projection.worker_fence !== lease.worker_fence
    ) {
      return staleCommitFailure(current.value, lease);
    }
    if (
      expectedProjectionHash !== undefined &&
      current.value.projection_hash !== expectedProjectionHash
    ) {
      return failure(
        "RUN_PROJECTION_CONFLICT",
        "Run Projection 已变化，拒绝基于旧版本提交。",
        true,
      );
    }
    return current;
  }

  async function reconcileStaleConflict(
    lease: RunWorkLease,
    failed: PortResult<unknown>,
  ): Promise<PortResult<RunWorkerCycleOutcome> | null> {
    if (
      failed.ok ||
      ![
        "RUN_COMMIT_CANCELLED_OR_STALE",
        "RUN_PROJECTION_CONFLICT",
        "RUN_QUEUE_STALE_FENCE",
      ].includes(failed.error.code)
    ) {
      return null;
    }
    const observed = await readProjection(lease);
    if (!observed.ok) {
      return observed;
    }
    if (
      observed.value.projection.status !== "RUNNING" ||
      observed.value.projection.worker_fence !== lease.worker_fence
    ) {
      return staleOutcome(lease, observed.value);
    }
    return null;
  }

  async function guardFinalProjection(
    lease: RunWorkLease,
    expected: RunProjectionRecord,
  ): Promise<PortResult<RunProjectionRecord>> {
    const current = await readProjection(lease);
    if (!current.ok) {
      return current;
    }
    if (
      current.value.projection_hash !== expected.projection_hash ||
      current.value.projection.worker_fence !== lease.worker_fence
    ) {
      return staleCommitFailure(current.value, lease);
    }
    return current;
  }

  async function appendWhileRunning(
    lease: RunWorkLease,
    buildEvent: (record: RunProjectionRecord) => unknown,
  ): Promise<PortResult<AppendResult>> {
    const current = await guardRunningLease(lease);
    if (!current.ok) {
      return current;
    }
    const eventResult = workerRunRuntimeEventSchema.safeParse(buildEvent(current.value));
    if (!eventResult.success) {
      return failure("RUN_EVENT_BUILD_INVALID", "Worker 生成的 Run Event 不满足权威契约。", false);
    }
    const appended = await dependencies.event_store.append({
      lease,
      event: eventResult.data,
      expected_projection: current.value,
    });
    if (!appended.ok) {
      return appended;
    }
    return success({
      event: appended.value.event,
      projection: {
        projection: appended.value.projection,
        projection_hash: appended.value.projection_hash,
      },
    });
  }

  async function appendLeaseEvent(
    lease: RunWorkLease,
    previous: RunProjectionRecord,
  ): Promise<PortResult<AppendResult>> {
    const eventResult = workerRunRuntimeEventSchema.safeParse({
      schema_version: "1.0.0",
      event_id: createId(),
      event_type: "run.leased",
      scope: lease.scope,
      run_id: lease.run_id,
      sequence: previous.projection.version + 1,
      worker_fence: lease.worker_fence,
      idempotency_key: eventIdempotencyKey(
        lease,
        "run-leased",
        `${lease.attempt_id}:${lease.worker_fence}`,
      ),
      occurred_at: occurredAt(now),
      payload: {
        command_id: lease.command_id,
        lease_id: lease.attempt_id,
        worker_id: lease.worker_id,
        attempt: lease.attempt_no,
      },
    });
    if (!eventResult.success) {
      return failure(
        "RUN_LEASE_EVENT_INVALID",
        "Queue Lease 无法生成有效的 run.leased Event。",
        false,
      );
    }
    const appended = await dependencies.event_store.append({
      lease,
      event: eventResult.data,
      expected_projection: previous,
    });
    if (!appended.ok) {
      return appended;
    }
    return success({
      event: appended.value.event,
      projection: {
        projection: appended.value.projection,
        projection_hash: appended.value.projection_hash,
      },
    });
  }

  async function appendSideEffectEvent(
    lease: RunWorkLease,
    receipt: SideEffectReceipt,
  ): Promise<PortResult<SideEffectReceipt>> {
    const idempotencyKey = sideEffectEventIdempotencyKey(lease, receipt);
    const projected = await dependencies.event_store.findEventByIdempotencyKey({
      scope: lease.scope,
      run_id: lease.run_id,
      idempotency_key: idempotencyKey,
    });
    if (!projected.ok) {
      return projected;
    }
    if (projected.value) {
      const event = projected.value;
      if (
        event.event_type !== "run.side_effect_committed" ||
        event.payload.receipt_id !== receipt.receipt_id ||
        event.payload.effect_kind !== receipt.effect_kind ||
        event.payload.input_hash !== receipt.input_hash ||
        event.payload.output_hash !== receipt.output_hash
      ) {
        return failure(
          "RUN_SIDE_EFFECT_EVENT_MISMATCH",
          "已投影 Side Effect Event 与权威 Receipt 不匹配。",
          false,
        );
      }
      return success(receipt);
    }

    const appended = await appendWhileRunning(lease, (record) => ({
      schema_version: "1.0.0",
      event_id: createId(),
      event_type: "run.side_effect_committed",
      scope: lease.scope,
      run_id: lease.run_id,
      sequence: record.projection.version + 1,
      worker_fence: lease.worker_fence,
      idempotency_key: idempotencyKey,
      occurred_at: occurredAt(now),
      payload: {
        receipt_id: receipt.receipt_id,
        effect_kind: receipt.effect_kind,
        input_hash: receipt.input_hash,
        output_hash: receipt.output_hash,
      },
    }));
    return appended.ok ? success(receipt) : appended;
  }

  function createExecutionContext(
    lease: RunWorkLease,
    runSignal: AbortSignal,
  ): RunExecutionContext {
    return createRunExecutionContext({
      lease,
      run_signal: runSignal,
      event_store: dependencies.event_store,
      now,
      create_id: createId,
      side_effect_timeout_ms: timing.side_effect_timeout_ms,
      heartbeat: () => dependencies.queue.heartbeat({ lease }),
      guard_running_lease: guardRunningLease,
      append_checkpoint_event: (binding) =>
        appendWhileRunning(lease, (record) => ({
          schema_version: "1.0.0",
          event_id: createId(),
          event_type: "run.checkpointed",
          scope: lease.scope,
          run_id: lease.run_id,
          sequence: record.projection.version + 1,
          worker_fence: lease.worker_fence,
          idempotency_key: eventIdempotencyKey(lease, "checkpoint", binding.snapshot_hash),
          occurred_at: occurredAt(now),
          payload: {
            snapshot_ref: {
              snapshot_id: binding.snapshot_id,
              snapshot_version: binding.snapshot_version,
              snapshot_hash: binding.snapshot_hash,
            },
            active_artifact_ref: binding.active_artifact_ref,
          },
        })),
      append_side_effect_event: (receipt) => appendSideEffectEvent(lease, receipt),
    });
  }

  async function completeQueue(
    lease: RunWorkLease,
    finalProjection: RunProjectionRecord,
    outcome: Extract<RunWorkerCycleOutcome["kind"], "COMPLETED" | "FAILED" | "SUSPENDED">,
  ): Promise<PortResult<RunWorkerCycleOutcome>> {
    const guarded = await guardFinalProjection(lease, finalProjection);
    if (!guarded.ok) {
      const stale = await reconcileStaleConflict(lease, guarded);
      if (stale) return stale;
      return guarded;
    }
    const completed = await dependencies.queue.complete({
      lease,
      final_event_sequence: finalProjection.projection.version,
    });
    if (!completed.ok) {
      const stale = await reconcileStaleConflict(lease, completed);
      if (stale) return stale;
      return completed;
    }
    return success({
      kind: outcome,
      run_id: lease.run_id,
      final_event_sequence: finalProjection.projection.version,
    });
  }

  async function failRun(
    lease: RunWorkLease,
    errorCode: string,
  ): Promise<PortResult<RunWorkerCycleOutcome>> {
    const appended = await appendWhileRunning(lease, (record) => ({
      schema_version: "1.0.0",
      event_id: createId(),
      event_type: "run.failed",
      scope: lease.scope,
      run_id: lease.run_id,
      sequence: record.projection.version + 1,
      worker_fence: lease.worker_fence,
      idempotency_key: eventIdempotencyKey(lease, "failed", `${lease.attempt_id}:${errorCode}`),
      occurred_at: occurredAt(now),
      payload: {
        error_code: errorCode,
        retryable: false,
      },
    }));
    if (!appended.ok) {
      const stale = await reconcileStaleConflict(lease, appended);
      if (stale) return stale;
      return appended;
    }
    return completeQueue(lease, appended.value.projection, "FAILED");
  }

  async function applyExecutorResult(
    lease: RunWorkLease,
    resultValue: unknown,
    context: RunExecutionContext,
  ): Promise<PortResult<RunWorkerCycleOutcome>> {
    const parsed = runExecutorResultSchema.safeParse(resultValue);
    if (!parsed.success) {
      return failRun(lease, "RUN_EXECUTOR_RESULT_INVALID");
    }

    const result = parsed.data;
    switch (result.kind) {
      case "COMPLETED": {
        const appended = await appendWhileRunning(lease, (record) => ({
          schema_version: "1.0.0",
          event_id: createId(),
          event_type: "run.completed",
          scope: lease.scope,
          run_id: lease.run_id,
          sequence: record.projection.version + 1,
          worker_fence: lease.worker_fence,
          idempotency_key: eventIdempotencyKey(lease, "completed", lease.attempt_id),
          occurred_at: occurredAt(now),
          payload: {
            completion_kind: "WORKFLOW_EXECUTION_ONLY",
          },
        }));
        if (!appended.ok) {
          const stale = await reconcileStaleConflict(lease, appended);
          if (stale) return stale;
          return appended;
        }
        return completeQueue(lease, appended.value.projection, "COMPLETED");
      }

      case "SUSPENDED": {
        const checkpoint = await context.checkpoint(result.checkpoint);
        if (!checkpoint.ok) {
          const stale = await reconcileStaleConflict(lease, checkpoint);
          if (stale) return stale;
          return checkpoint;
        }
        const appended = await appendWhileRunning(lease, (record) => ({
          schema_version: "1.0.0",
          event_id: createId(),
          event_type: "run.suspended",
          scope: lease.scope,
          run_id: lease.run_id,
          sequence: record.projection.version + 1,
          worker_fence: lease.worker_fence,
          idempotency_key: eventIdempotencyKey(lease, "suspended", checkpoint.value.snapshot_id),
          occurred_at: occurredAt(now),
          payload: {
            reason_code: result.reason_code,
            snapshot_id: checkpoint.value.snapshot_id,
          },
        }));
        if (!appended.ok) {
          const stale = await reconcileStaleConflict(lease, appended);
          if (stale) return stale;
          return appended;
        }
        return completeQueue(lease, appended.value.projection, "SUSPENDED");
      }

      case "RETRY": {
        if (lease.delivery_attempt_no >= RUN_RETRY_MAX_ATTEMPTS) {
          return failRun(lease, "RUN_ATTEMPT_BUDGET_EXHAUSTED");
        }
        const appended = await appendWhileRunning(lease, (record) => ({
          schema_version: "1.0.0",
          event_id: createId(),
          event_type: "run.retry_scheduled",
          scope: lease.scope,
          run_id: lease.run_id,
          sequence: record.projection.version + 1,
          worker_fence: lease.worker_fence,
          idempotency_key: eventIdempotencyKey(
            lease,
            "retry",
            `${lease.attempt_id}:${result.error_code}`,
          ),
          occurred_at: occurredAt(now),
          payload: {
            command_id: lease.command_id,
            error_code: result.error_code,
            retry_delay_ms: result.retry_delay_ms,
          },
        }));
        if (!appended.ok) {
          const stale = await reconcileStaleConflict(lease, appended);
          if (stale) return stale;
          return appended;
        }
        const guarded = await guardFinalProjection(lease, appended.value.projection);
        if (!guarded.ok) {
          const stale = await reconcileStaleConflict(lease, guarded);
          if (stale) return stale;
          return guarded;
        }
        const retried = await dependencies.queue.retry({
          lease,
          final_event_sequence: appended.value.projection.projection.version,
          error_code: result.error_code,
          retry_delay_ms: result.retry_delay_ms,
        });
        if (!retried.ok) {
          const stale = await reconcileStaleConflict(lease, retried);
          if (stale) return stale;
          return retried;
        }
        return success({
          kind: "RETRY_SCHEDULED",
          run_id: lease.run_id,
          final_event_sequence: appended.value.projection.projection.version,
        });
      }

      case "FAILED": {
        return failRun(lease, result.error_code);
      }
    }
  }

  return {
    async runOnce(input) {
      const leased = await dependencies.queue.lease(input);
      if (!leased.ok) {
        return leased;
      }
      if (!leased.value) {
        return success({ kind: "IDLE" });
      }
      const leaseResult = runWorkLeaseSchema.safeParse(leased.value);
      if (
        !leaseResult.success ||
        !scopesMatch(leaseResult.data.scope, input.scope) ||
        leaseResult.data.worker_id !== input.worker_id
      ) {
        return failure("WORKER_LEASE_INVALID", "Queue 返回的 Lease 与 Worker 请求不匹配。", false);
      }
      const lease = leaseResult.data;
      const current = await readProjection(lease);
      if (!current.ok) {
        return current;
      }
      if (
        current.value.projection.status === "COMPLETED" ||
        current.value.projection.status === "FAILED"
      ) {
        const completed = await dependencies.queue.complete({
          lease,
          final_event_sequence: current.value.projection.version,
        });
        if (!completed.ok) {
          const stale = await reconcileStaleConflict(lease, completed);
          if (stale) return stale;
          return completed;
        }
        return success({
          kind: "TERMINAL_RECONCILED",
          run_id: lease.run_id,
          final_event_sequence: current.value.projection.version,
        });
      }
      if (
        current.value.projection.status === "CANCELLED" ||
        current.value.projection.status === "WAITING"
      ) {
        return staleOutcome(lease, current.value);
      }

      const leasedEvent = await appendLeaseEvent(lease, current.value);
      if (!leasedEvent.ok) {
        const stale = await reconcileStaleConflict(lease, leasedEvent);
        if (stale) return stale;
        return leasedEvent;
      }
      const initialHeartbeat = await dependencies.queue.heartbeat({ lease });
      if (!initialHeartbeat.ok) {
        const stale = await reconcileStaleConflict(lease, initialHeartbeat);
        if (stale) return stale;
        return initialHeartbeat;
      }
      const runController = new AbortController();
      const executionDeadlineAt = new Date(
        now().getTime() + timing.execution_timeout_ms,
      ).toISOString();
      const heartbeatIntervalMs = Math.min(
        timing.heartbeat_interval_ms,
        Math.floor(lease.lease_duration_ms / 3),
      );
      const context = createExecutionContext(lease, runController.signal);
      const supervisor = createRunExecutionSupervisor({
        context,
        controller: runController,
        execution_timeout_ms: timing.execution_timeout_ms,
        heartbeat_interval_ms: heartbeatIntervalMs,
      });
      const settleDeadline = () =>
        applyExecutorResult(
          lease,
          lease.delivery_attempt_no >= RUN_RETRY_MAX_ATTEMPTS
            ? {
                kind: "FAILED",
                error_code: "RUN_ATTEMPT_BUDGET_EXHAUSTED",
              }
            : {
                kind: "RETRY",
                error_code: "RUN_EXECUTION_TIMEOUT",
                retry_delay_ms: RUN_RETRY_MIN_DELAY_MS,
              },
          context,
        );
      const settleHeartbeatFailure = async (error: ContractError) => {
        const heartbeatFailure = { ok: false, error } as const;
        const stale = await reconcileStaleConflict(lease, heartbeatFailure);
        return stale ?? heartbeatFailure;
      };

      try {
        const restorationOutcome = await supervisor.waitFor(() =>
          dependencies.event_store.loadLatestSnapshot({
            scope: lease.scope,
            run_id: lease.run_id,
          }),
        );
        if (restorationOutcome.kind === "HEARTBEAT_FAILED") {
          return settleHeartbeatFailure(restorationOutcome.error);
        }
        if (restorationOutcome.kind === "DEADLINE") {
          return settleDeadline();
        }
        if (restorationOutcome.kind === "ERROR") {
          return processCrashFailure();
        }
        const restored = restorationOutcome.value;
        if (!restored.ok) {
          return restored;
        }
        const restoredSnapshot = restored.value
          ? mastraSnapshotBindingSchema.safeParse(restored.value)
          : null;
        if (restoredSnapshot && !restoredSnapshot.success) {
          return failure(
            "RUN_SNAPSHOT_INVALID",
            "持久层返回的 Snapshot 不满足权威绑定契约。",
            false,
          );
        }
        const restorationHeartbeat = await context.heartbeat();
        if (!restorationHeartbeat.ok) {
          const stale = await reconcileStaleConflict(lease, restorationHeartbeat);
          if (stale) return stale;
          return restorationHeartbeat;
        }

        const executorOutcome = await supervisor.waitFor(() =>
          dependencies.executor.execute({
            lease,
            restored_snapshot: restoredSnapshot?.data ?? null,
            context,
            signal: runController.signal,
            deadline_at: executionDeadlineAt,
          }),
        );
        if (executorOutcome.kind === "HEARTBEAT_FAILED") {
          return settleHeartbeatFailure(executorOutcome.error);
        }
        if (executorOutcome.kind === "DEADLINE") {
          return settleDeadline();
        }
        supervisor.markExecutorSettled();
        if (executorOutcome.kind === "ERROR") {
          const observed = await readProjection(lease);
          if (
            observed.ok &&
            (observed.value.projection.status !== "RUNNING" ||
              observed.value.projection.worker_fence !== lease.worker_fence)
          ) {
            return staleOutcome(lease, observed.value);
          }
          if (lease.delivery_attempt_no >= RUN_RETRY_MAX_ATTEMPTS) {
            const exhausted = await failRun(lease, "RUN_ATTEMPT_BUDGET_EXHAUSTED");
            return exhausted;
          }
          return processCrashFailure();
        }
        const applied = await applyExecutorResult(lease, executorOutcome.value, context);
        return applied;
      } finally {
        supervisor.stop();
      }
    },
  };
}
