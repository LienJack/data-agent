import {
  type AppScope,
  agentProfileIdSchema,
  artifactReferenceSchema,
  type ContextReceiptBinding,
  type ContractError,
  canonicalizeJson,
  contextReceiptBindingSchema,
  runCheckpointInputSchema as contractRunCheckpointInputSchema,
  type EffectiveRunConfigReceiptCandidate,
  effectiveConfigRunLeasePayloadSchema,
  effectiveRunConfigReceiptCandidateSchema,
  type MastraSnapshotBinding,
  mastraSnapshotBindingSchema,
  type PortResult,
  RUN_RETRY_MIN_DELAY_MS,
  type RunEventStorePort,
  type RunExecutionPolicy,
  type RunProjectionRecord,
  type RunQueuePort,
  type RunRuntimeEvent,
  type RunWorkLease,
  redactPublicDisplayText,
  retryDelayMsSchema,
  runWorkLeaseSchema,
  type SideEffectReceipt,
  verifyContextReceiptBindingCandidate,
  verifyEffectiveRunConfigReceiptCandidate,
  workerRunRuntimeEventSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  createRunExecutionContext,
  type RunBoundProviderDispatcher,
  type RunBoundSemanticContextResolver,
  type RunExecutionContextProvenance,
  type RunProviderDispatchCapability,
  type RunSemanticContextCapability,
} from "./run-execution-context.js";
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

const runDisplayEventInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("progress"),
    key: z.string().min(1).max(128),
    phase: z.string().min(1).max(128),
    title: z.string().min(1).max(128),
    summary: z.string().min(1).max(100_000),
    status: z.enum(["RUNNING", "COMPLETED"]),
  }),
  z.strictObject({
    kind: z.literal("tool_started"),
    key: z.string().min(1).max(128),
    call_id: z.string().min(1).max(256),
    tool_name: z.string().min(1).max(128),
    title: z.string().min(1).max(128),
    summary: z.string().min(1).max(100_000),
    input: z.string().max(100_000).nullable(),
    profile_id: agentProfileIdSchema.nullable().optional(),
    task_id: z.uuid().nullable().optional(),
    artifact_refs: z.array(artifactReferenceSchema).max(32).optional(),
  }),
  z.strictObject({
    kind: z.literal("tool_completed"),
    key: z.string().min(1).max(128),
    call_id: z.string().min(1).max(256),
    tool_name: z.string().min(1).max(128),
    summary: z.string().min(1).max(100_000),
    output: z.string().max(200_000).nullable(),
    duration_ms: z.number().int().nonnegative().safe(),
    profile_id: agentProfileIdSchema.nullable().optional(),
    task_id: z.uuid().nullable().optional(),
    artifact_refs: z.array(artifactReferenceSchema).max(32).optional(),
  }),
  z.strictObject({
    kind: z.literal("tool_failed"),
    key: z.string().min(1).max(128),
    call_id: z.string().min(1).max(256),
    tool_name: z.string().min(1).max(128),
    summary: z.string().min(1).max(100_000),
    error_code: stableReasonCodeSchema,
    output: z.string().max(200_000).nullable(),
    duration_ms: z.number().int().nonnegative().safe(),
    profile_id: agentProfileIdSchema.nullable().optional(),
    task_id: z.uuid().nullable().optional(),
    artifact_refs: z.array(artifactReferenceSchema).max(32).optional(),
  }),
  z.strictObject({
    kind: z.literal("agent_status"),
    key: z.string().min(1).max(128),
    profile_id: agentProfileIdSchema,
    task_id: z.uuid().nullable(),
    status: z.enum([
      "PENDING",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "INTERRUPTED",
      "SKIPPED",
      "BLOCKED",
    ]),
    phase: z.string().min(1).max(128),
    title: z.string().min(1).max(128),
    summary: z.string().min(1).max(100_000),
    duration_ms: z.number().int().nonnegative().safe().nullable(),
    error_code: stableReasonCodeSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("answer_delta"),
    key: z.string().min(1).max(128),
    delta: z.string().min(1).max(100_000),
  }),
  z.strictObject({
    kind: z.literal("reasoning_started"),
    key: z.string().min(1).max(128),
    block_id: z.string().min(1).max(256),
    title: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("reasoning_delta"),
    key: z.string().min(1).max(128),
    block_id: z.string().min(1).max(256),
    delta: z.string().min(1).max(4_096),
  }),
  z.strictObject({
    kind: z.literal("reasoning_completed"),
    key: z.string().min(1).max(128),
    block_id: z.string().min(1).max(256),
    summary: z.string().min(1).max(100_000),
    duration_ms: z.number().int().nonnegative().safe(),
  }),
]);

export type RunDisplayEventInput = z.infer<typeof runDisplayEventInputSchema>;

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

export interface RunExecutionContext extends RunExecutionContextProvenance {
  getEffectiveConfig(): EffectiveRunConfigReceiptCandidate;
  getContextReceipt(): ContextReceiptBinding;
  getProviderDispatchCapability(): RunProviderDispatchCapability | null;
  getSemanticContextCapability?(): RunSemanticContextCapability | null;
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
  emitDisplayEvent?(
    input: RunDisplayEventInput,
  ): Promise<PortResult<{ readonly sequence: number }>>;
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
  readonly effective_config_loader: (lease: RunWorkLease) => Promise<PortResult<unknown>>;
  readonly provider_dispatch?: RunBoundProviderDispatcher;
  readonly semantic_context?: RunBoundSemanticContextResolver;
  readonly now?: () => Date;
  readonly create_id?: () => string;
  readonly execution_timeout_ms?: number;
  readonly heartbeat_interval_ms?: number;
  readonly side_effect_timeout_ms?: number;
  readonly on_run_failure?: (input: {
    readonly lease: RunWorkLease;
    readonly error_code: string;
    readonly execution_policy: RunExecutionPolicy;
  }) => Promise<PortResult<void>>;
  readonly reconcile_run_failures?: () => Promise<PortResult<void>>;
}

const effectiveConfigWorkerConsumptionSchema = z.strictObject({
  schema_version: z.literal("effective-config-worker-consumption@1.0.0"),
  replayed: z.boolean(),
  context_receipt: contextReceiptBindingSchema,
  effective_config: effectiveRunConfigReceiptCandidateSchema,
});

type EffectiveConfigWorkerConsumption = z.infer<typeof effectiveConfigWorkerConsumptionSchema>;

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

function sameVersionedResource(
  left: Readonly<{ resource_id: string; resource_revision: number; resource_hash: string }>,
  right: Readonly<{ resource_id: string; resource_revision: number; resource_hash: string }>,
): boolean {
  return (
    left.resource_id === right.resource_id &&
    left.resource_revision === right.resource_revision &&
    left.resource_hash === right.resource_hash
  );
}

function canonicalAvailableResourceReferences(receipt: EffectiveRunConfigReceiptCandidate) {
  return receipt.resource_bindings
    .flatMap((binding) =>
      binding.availability === "AVAILABLE" && binding.effective_resource
        ? [binding.effective_resource]
        : [],
    )
    .toSorted((left, right) => {
      if (left.resource_id !== right.resource_id) {
        return left.resource_id < right.resource_id ? -1 : 1;
      }
      if (left.resource_revision !== right.resource_revision) {
        return left.resource_revision - right.resource_revision;
      }
      return left.resource_hash < right.resource_hash
        ? -1
        : left.resource_hash > right.resource_hash
          ? 1
          : 0;
    })
    .map(({ resource_id, resource_revision, resource_hash }) => ({
      resource_id,
      resource_revision,
      resource_hash,
    }));
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
    side_effect_timeout_ms: dependencies.side_effect_timeout_ms ?? 180_000,
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

  async function loadTerminalFailureCode(
    lease: RunWorkLease,
    record: RunProjectionRecord,
  ): Promise<PortResult<string>> {
    const terminalEventId = record.projection.terminal_event_id;
    const events = await dependencies.event_store.listEvents({
      scope: lease.scope,
      run_id: lease.run_id,
      after_sequence: record.projection.version - 1,
      limit: 1,
    });
    if (!events.ok) return events;
    const terminal = events.value[0];
    if (
      !terminalEventId ||
      events.value.length !== 1 ||
      !terminal ||
      terminal.event_id !== terminalEventId ||
      terminal.sequence !== record.projection.version ||
      terminal.event_type !== "run.failed"
    ) {
      return failure(
        "RUN_FAILURE_TERMINAL_EVENT_INVALID",
        "FAILED Run 终态事件无法通过 exact event identity 验证。",
        false,
      );
    }
    return success(terminal.payload.error_code);
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

  async function appendDisplayEvent(
    lease: RunWorkLease,
    inputValue: RunDisplayEventInput,
  ): Promise<PortResult<{ readonly sequence: number }>> {
    const parsed = runDisplayEventInputSchema.safeParse(inputValue);
    if (!parsed.success) {
      return failure("RUN_DISPLAY_EVENT_INPUT_INVALID", "显示事件不满足项目契约。", false);
    }
    const { key, kind, ...rawPayload } = parsed.data;
    const normalizedPayload = kind.startsWith("tool_")
      ? {
          ...rawPayload,
          profile_id: "profile_id" in rawPayload ? (rawPayload.profile_id ?? null) : null,
          task_id: "task_id" in rawPayload ? (rawPayload.task_id ?? null) : null,
          artifact_refs: "artifact_refs" in rawPayload ? (rawPayload.artifact_refs ?? []) : [],
        }
      : rawPayload;
    const payload = Object.fromEntries(
      Object.entries(normalizedPayload).map(([field, value]) => [
        field,
        typeof value === "string" ? redactPublicDisplayText(value) : value,
      ]),
    );
    const eventType = `run.${kind}` as const;
    const idempotencyKey = eventIdempotencyKey(lease, "display", `${lease.attempt_id}:${key}`);
    const existing = await dependencies.event_store.findEventByIdempotencyKey({
      scope: lease.scope,
      run_id: lease.run_id,
      idempotency_key: idempotencyKey,
    });
    if (!existing.ok) return existing;
    if (existing.value) {
      if (
        existing.value.event_type !== eventType ||
        canonicalizeJson(existing.value.payload) !== canonicalizeJson(payload)
      ) {
        return failure(
          "RUN_DISPLAY_EVENT_REPLAY_MISMATCH",
          "同一显示事件幂等键对应了不同载荷。",
          false,
        );
      }
      return success({ sequence: existing.value.sequence });
    }
    const appended = await appendWhileRunning(lease, (record) => ({
      schema_version:
        kind.startsWith("tool_") || kind === "agent_status" ? "run-runtime-event@2.0.0" : "1.0.0",
      event_id: createId(),
      event_type: eventType,
      scope: lease.scope,
      run_id: lease.run_id,
      sequence: record.projection.version + 1,
      worker_fence: lease.worker_fence,
      idempotency_key: idempotencyKey,
      occurred_at: occurredAt(now),
      payload,
    }));
    return appended.ok ? success({ sequence: appended.value.event.sequence }) : appended;
  }

  function createExecutionContext(
    lease: RunWorkLease,
    runSignal: AbortSignal,
    consumption: EffectiveConfigWorkerConsumption,
  ): RunExecutionContext {
    return createRunExecutionContext({
      lease,
      effective_config: consumption.effective_config,
      context_receipt: consumption.context_receipt,
      run_signal: runSignal,
      event_store: dependencies.event_store,
      now,
      create_id: createId,
      side_effect_timeout_ms: timing.side_effect_timeout_ms,
      provider_dispatch: dependencies.provider_dispatch ?? null,
      semantic_context: dependencies.semantic_context ?? null,
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
      append_display_event: (input) => appendDisplayEvent(lease, input),
    });
  }

  async function loadEffectiveConfig(
    lease: RunWorkLease,
  ): Promise<PortResult<EffectiveConfigWorkerConsumption>> {
    const loaded = await dependencies.effective_config_loader(lease);
    if (!loaded.ok) return loaded;
    const parsed = effectiveConfigWorkerConsumptionSchema.safeParse(loaded.value);
    if (!parsed.success) {
      return failure(
        "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
        "Effective Config Loader 返回了无效消费回执。",
        false,
      );
    }
    try {
      const [effectiveConfig, contextReceipt] = await Promise.all([
        verifyEffectiveRunConfigReceiptCandidate(parsed.data.effective_config),
        verifyContextReceiptBindingCandidate(parsed.data.context_receipt),
      ]);
      const configRef = effectiveConfigRunLeasePayloadSchema.parse(
        lease.payload,
      ).effective_config_ref;
      if (
        effectiveConfig.run_id !== lease.run_id ||
        effectiveConfig.scope.app_id !== lease.scope.app_id ||
        effectiveConfig.scope.tenant_id !== lease.scope.tenant_id ||
        effectiveConfig.scope.environment !== lease.scope.environment ||
        effectiveConfig.scope.principal_id !== lease.principal_id ||
        effectiveConfig.config_id !== configRef.config_id ||
        effectiveConfig.config_revision !== configRef.config_revision ||
        effectiveConfig.config_hash !== configRef.config_hash ||
        contextReceipt.consumer !== "WORKER_START" ||
        contextReceipt.receipt_id !== lease.attempt_id ||
        contextReceipt.outbox_id !== lease.outbox_id ||
        contextReceipt.command_id !== lease.command_id ||
        contextReceipt.scope.app_id !== lease.scope.app_id ||
        contextReceipt.scope.tenant_id !== lease.scope.tenant_id ||
        contextReceipt.scope.environment !== lease.scope.environment ||
        contextReceipt.scope.principal_id !== lease.principal_id ||
        contextReceipt.scope.workspace_id !== effectiveConfig.scope.workspace_id ||
        contextReceipt.consumer_id !== lease.worker_id ||
        contextReceipt.attempt_id !== lease.attempt_id ||
        contextReceipt.lease_token !== lease.lease_token ||
        contextReceipt.worker_fence !== lease.worker_fence ||
        contextReceipt.run_id !== lease.run_id ||
        contextReceipt.config_ref.config_id !== configRef.config_id ||
        contextReceipt.config_ref.config_revision !== configRef.config_revision ||
        contextReceipt.config_ref.config_hash !== configRef.config_hash ||
        !sameVersionedResource(contextReceipt.semantic_release, effectiveConfig.semantic_release) ||
        contextReceipt.semantic_release.datasource_id !==
          effectiveConfig.semantic_release.datasource_id ||
        contextReceipt.semantic_release.semantic_generation !==
          effectiveConfig.semantic_release.semantic_generation ||
        contextReceipt.semantic_release.publication_status !==
          effectiveConfig.semantic_release.publication_status ||
        !sameVersionedResource(contextReceipt.schema_snapshot, effectiveConfig.schema_snapshot) ||
        contextReceipt.schema_snapshot.datasource_id !==
          effectiveConfig.schema_snapshot.datasource_id ||
        contextReceipt.schema_snapshot.semantic_release_id !==
          effectiveConfig.schema_snapshot.semantic_release_id ||
        contextReceipt.schema_snapshot.semantic_generation !==
          effectiveConfig.schema_snapshot.semantic_generation ||
        !sameVersionedResource(contextReceipt.context_policy, effectiveConfig.context_policy) ||
        contextReceipt.provider !== effectiveConfig.model.provider ||
        JSON.stringify(contextReceipt.audiences) !==
          JSON.stringify(effectiveConfig.effective_egress.allowed_audiences) ||
        contextReceipt.classification !== effectiveConfig.effective_egress.classification ||
        JSON.stringify(contextReceipt.resource_refs) !==
          JSON.stringify(canonicalAvailableResourceReferences(effectiveConfig))
      ) {
        return failure(
          "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
          "Effective Config、Context Receipt 与 Lease 不一致。",
          false,
        );
      }
      return success({
        ...parsed.data,
        effective_config: effectiveConfig,
        context_receipt: contextReceipt,
      });
    } catch {
      return failure(
        "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
        "Effective Config 或 Context Receipt 完整性校验失败。",
        false,
      );
    }
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
    executionPolicy: RunExecutionPolicy,
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
    const failureHook = await invokeRunFailureHook(lease, executionPolicy, errorCode);
    if (!failureHook.ok) return failureHook;
    const completed = await completeQueue(lease, appended.value.projection, "FAILED");
    if (!completed.ok) return completed;
    return completed;
  }

  async function settleLeasedFailure(
    lease: RunWorkLease,
    executionPolicy: RunExecutionPolicy,
    failed: PortResult<unknown>,
  ): Promise<PortResult<RunWorkerCycleOutcome>> {
    if (failed.ok) {
      throw new TypeError("RUN_WORKER_FAILURE_SETTLEMENT_REQUIRES_FAILURE");
    }
    const stale = await reconcileStaleConflict(lease, failed);
    if (stale) return stale;
    if (executionPolicy.max_run_attempts === 1)
      return failRun(lease, executionPolicy, failed.error.code);
    return failed;
  }

  async function invokeRunFailureHook(
    lease: RunWorkLease,
    executionPolicy: RunExecutionPolicy,
    errorCode: string,
  ): Promise<PortResult<void>> {
    if (!executionPolicy.hold_on_failure) return success(undefined);
    if (!dependencies.on_run_failure) {
      return failure("RUN_FAILURE_HOOK_REQUIRED", "严格验收 Run 缺少数据库 HOLD hook。", false);
    }
    try {
      return await dependencies.on_run_failure({
        lease,
        error_code: errorCode,
        execution_policy: executionPolicy,
      });
    } catch {
      return failure(
        "RUN_FAILURE_HOOK_FAILED",
        "Run failure hook 未能持久化严格验收 HOLD。",
        false,
      );
    }
  }

  async function applyExecutorResult(
    lease: RunWorkLease,
    resultValue: unknown,
    context: RunExecutionContext,
    executionPolicy: RunExecutionPolicy,
  ): Promise<PortResult<RunWorkerCycleOutcome>> {
    const parsed = runExecutorResultSchema.safeParse(resultValue);
    if (!parsed.success) {
      return failRun(lease, executionPolicy, "RUN_EXECUTOR_RESULT_INVALID");
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
        if (lease.delivery_attempt_no >= executionPolicy.max_run_attempts) {
          return failRun(lease, executionPolicy, "RUN_ATTEMPT_BUDGET_EXHAUSTED");
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
        return failRun(lease, executionPolicy, result.error_code);
      }
    }
  }

  return {
    async runOnce(input) {
      if (dependencies.reconcile_run_failures) {
        let reconciled: PortResult<void>;
        try {
          reconciled = await dependencies.reconcile_run_failures();
        } catch {
          reconciled = failure(
            "RUN_FAILURE_RECONCILIATION_FAILED",
            "Run failure reconciliation 未能恢复严格验收 HOLD。",
            false,
          );
        }
        if (!reconciled.ok) return reconciled;
      }
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
      const payload = effectiveConfigRunLeasePayloadSchema.safeParse(leaseResult.data.payload);
      if (!payload.success) {
        return failure(
          "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
          "Worker Lease 必须只携带 Effective Config Reference。",
          false,
        );
      }
      const lease = { ...leaseResult.data, payload: payload.data };
      if (lease.command_kind !== payload.data.kind) {
        return failure(
          "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
          "Worker Lease Command Kind 与 Effective Config Payload 不一致。",
          false,
        );
      }
      const executionPolicy = lease.execution_policy;
      const current = await readProjection(lease);
      if (!current.ok) {
        return current;
      }
      if (
        current.value.projection.status === "COMPLETED" ||
        current.value.projection.status === "FAILED"
      ) {
        if (current.value.projection.status === "FAILED" && executionPolicy.hold_on_failure) {
          const errorCode = await loadTerminalFailureCode(lease, current.value);
          if (!errorCode.ok) return errorCode;
          const failureHook = await invokeRunFailureHook(lease, executionPolicy, errorCode.value);
          if (!failureHook.ok) return failureHook;
        }
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
      let initialHeartbeat: PortResult<{ readonly expires_at: string }>;
      try {
        initialHeartbeat = await dependencies.queue.heartbeat({ lease });
      } catch {
        initialHeartbeat = failure(
          "RUN_QUEUE_HEARTBEAT_FAILED",
          "Run Queue 初始 Heartbeat 执行失败。",
          false,
        );
      }
      if (!initialHeartbeat.ok) {
        return settleLeasedFailure(lease, executionPolicy, initialHeartbeat);
      }
      // Effective Config consumption is fence-bound and therefore must happen
      // only after the durable run.leased event has advanced the projection to
      // RUNNING for this exact worker fence.
      let effectiveConfig: PortResult<EffectiveConfigWorkerConsumption>;
      try {
        effectiveConfig = await loadEffectiveConfig(lease);
      } catch {
        effectiveConfig = failure(
          "EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID",
          "Effective Config Loader 执行失败。",
          false,
        );
      }
      if (!effectiveConfig.ok) return settleLeasedFailure(lease, executionPolicy, effectiveConfig);
      const runController = new AbortController();
      const executionDeadlineAt = new Date(
        now().getTime() + timing.execution_timeout_ms,
      ).toISOString();
      const heartbeatIntervalMs = Math.min(
        timing.heartbeat_interval_ms,
        Math.floor(lease.lease_duration_ms / 3),
      );
      const context = createExecutionContext(lease, runController.signal, effectiveConfig.value);
      const supervisor = createRunExecutionSupervisor({
        context,
        controller: runController,
        execution_timeout_ms: timing.execution_timeout_ms,
        heartbeat_interval_ms: heartbeatIntervalMs,
      });
      const settleDeadline = () =>
        applyExecutorResult(
          lease,
          lease.delivery_attempt_no >= executionPolicy.max_run_attempts
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
          executionPolicy,
        );
      const settleHeartbeatFailure = async (error: ContractError) => {
        const heartbeatFailure = { ok: false, error } as const;
        return settleLeasedFailure(lease, executionPolicy, heartbeatFailure);
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
          if (lease.delivery_attempt_no >= executionPolicy.max_run_attempts) {
            return failRun(lease, executionPolicy, "RUN_ATTEMPT_BUDGET_EXHAUSTED");
          }
          return processCrashFailure();
        }
        const restored = restorationOutcome.value;
        if (!restored.ok) {
          return settleLeasedFailure(lease, executionPolicy, restored);
        }
        const restoredSnapshot = restored.value
          ? mastraSnapshotBindingSchema.safeParse(restored.value)
          : null;
        if (restoredSnapshot && !restoredSnapshot.success) {
          return settleLeasedFailure(
            lease,
            executionPolicy,
            failure<never>(
              "RUN_SNAPSHOT_INVALID",
              "持久层返回的 Snapshot 不满足权威绑定契约。",
              false,
            ),
          );
        }
        let restorationHeartbeat: PortResult<{ readonly expires_at: string }>;
        try {
          restorationHeartbeat = await context.heartbeat();
        } catch {
          restorationHeartbeat = failure(
            "RUN_QUEUE_HEARTBEAT_FAILED",
            "Snapshot 恢复后的 Heartbeat 执行失败。",
            false,
          );
        }
        if (!restorationHeartbeat.ok) {
          return settleLeasedFailure(lease, executionPolicy, restorationHeartbeat);
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
          if (lease.delivery_attempt_no >= executionPolicy.max_run_attempts) {
            const exhausted = await failRun(lease, executionPolicy, "RUN_ATTEMPT_BUDGET_EXHAUSTED");
            return exhausted;
          }
          return processCrashFailure();
        }
        const applied = await applyExecutorResult(
          lease,
          executorOutcome.value,
          context,
          executionPolicy,
        );
        return applied;
      } finally {
        supervisor.stop();
      }
    },
  };
}
