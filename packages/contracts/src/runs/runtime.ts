import { z } from "zod";
import { type ArtifactReference, artifactReferenceSchema } from "../artifacts/index.js";
import {
  type AppScope,
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  type PortResult,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

export const runtimeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
export const eventIdempotencyKeySchema = z.string().min(1).max(256);
const positiveSafeIntegerSchema = z.number().int().positive().safe();
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
export const RUN_RETRY_MIN_DELAY_MS = 1_000;
export const RUN_RETRY_MAX_ATTEMPTS = 5;
export const retryDelayMsSchema = z.number().int().min(RUN_RETRY_MIN_DELAY_MS).max(86_400_000);
export const runLeaseDurationMsSchema = z.number().int().min(5_000).max(900_000);
export const runtimeTimestampSchema = timestampSchema.refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
  "Runtime Timestamp 必须是 PostgreSQL 签发的 UTC 毫秒格式。",
);

const runtimeEventFields = {
  schema_version: z.literal("1.0.0"),
  event_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  sequence: positiveSafeIntegerSchema,
  worker_fence: nonNegativeSafeIntegerSchema,
  idempotency_key: eventIdempotencyKeySchema,
  occurred_at: runtimeTimestampSchema,
} as const;

const runAcceptedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.accepted"),
  payload: z.strictObject({
    command_id: immutableIdSchema,
    payload_hash: contentHashSchema,
  }),
});

const runLeasedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.leased"),
  payload: z.strictObject({
    command_id: immutableIdSchema,
    lease_id: runtimeIdentifierSchema,
    worker_id: runtimeIdentifierSchema,
    attempt: positiveSafeIntegerSchema,
  }),
});

const snapshotReferenceSchema = z.strictObject({
  snapshot_id: immutableIdSchema,
  snapshot_version: positiveSafeIntegerSchema,
  snapshot_hash: contentHashSchema,
});

const runCheckpointedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.checkpointed"),
  payload: z.strictObject({
    snapshot_ref: snapshotReferenceSchema,
    active_artifact_ref: artifactReferenceSchema.nullable(),
  }),
});

const runSideEffectCommittedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.side_effect_committed"),
  payload: z.strictObject({
    receipt_id: immutableIdSchema,
    effect_kind: z.enum(["SQL", "EVAL"]),
    input_hash: contentHashSchema,
    output_hash: contentHashSchema,
  }),
});

const runSuspendedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.suspended"),
  payload: z.strictObject({
    reason_code: runtimeIdentifierSchema,
    snapshot_id: immutableIdSchema,
  }),
});

const runResumedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.resumed"),
  payload: z.strictObject({
    command_id: immutableIdSchema,
  }),
});

const runRetryScheduledEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.retry_scheduled"),
  payload: z.strictObject({
    command_id: immutableIdSchema,
    error_code: runtimeIdentifierSchema,
    retry_delay_ms: retryDelayMsSchema,
  }),
});

const runCancelRequestedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.cancel_requested"),
  payload: z.strictObject({
    command_id: immutableIdSchema,
  }),
});

const runCompletedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.completed"),
  payload: z.strictObject({
    completion_kind: z.literal("WORKFLOW_EXECUTION_ONLY"),
  }),
});

const runFailedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.failed"),
  payload: z.strictObject({
    error_code: runtimeIdentifierSchema,
    retryable: z.boolean(),
  }),
});

export const runRuntimeEventSchema = z
  .discriminatedUnion("event_type", [
    runAcceptedEventSchema,
    runLeasedEventSchema,
    runCheckpointedEventSchema,
    runSideEffectCommittedEventSchema,
    runSuspendedEventSchema,
    runResumedEventSchema,
    runRetryScheduledEventSchema,
    runCancelRequestedEventSchema,
    runCompletedEventSchema,
    runFailedEventSchema,
  ])
  .superRefine((event, ctx) => {
    if (
      event.event_type === "run.checkpointed" &&
      event.payload.active_artifact_ref &&
      !referenceBelongsToRun(event.payload.active_artifact_ref, event.scope, event.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Checkpoint 的 Active Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["payload", "active_artifact_ref"],
      });
    }
  });

export const workerRunRuntimeEventSchema = z
  .discriminatedUnion("event_type", [
    runLeasedEventSchema,
    runCheckpointedEventSchema,
    runSideEffectCommittedEventSchema,
    runSuspendedEventSchema,
    runRetryScheduledEventSchema,
    runCompletedEventSchema,
    runFailedEventSchema,
  ])
  .superRefine((event, ctx) => {
    if (
      event.event_type === "run.checkpointed" &&
      event.payload.active_artifact_ref &&
      !referenceBelongsToRun(event.payload.active_artifact_ref, event.scope, event.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Checkpoint 的 Active Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["payload", "active_artifact_ref"],
      });
    }
  });

export const runProjectionSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  status: z.enum(["QUEUED", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"]),
  version: positiveSafeIntegerSchema,
  worker_fence: nonNegativeSafeIntegerSchema,
  attempt_count: nonNegativeSafeIntegerSchema,
  last_event_id: immutableIdSchema,
  last_occurred_at: runtimeTimestampSchema,
  active_artifact_ref: artifactReferenceSchema.nullable(),
  active_snapshot_ref: snapshotReferenceSchema.nullable(),
  last_side_effect_receipt_id: immutableIdSchema.nullable(),
  terminal_event_id: immutableIdSchema.nullable(),
});

export class RunProjectionError extends Error {
  override readonly name = "RunProjectionError";

  constructor(
    readonly code:
      | "RUN_EVENT_SEQUENCE_INVALID"
      | "RUN_EVENT_SCOPE_MISMATCH"
      | "RUN_EVENT_AFTER_TERMINAL"
      | "RUN_EVENT_FENCE_INVALID"
      | "RUN_EVENT_TRANSITION_INVALID",
    message: string,
  ) {
    super(message);
  }
}

function scopesMatch(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function referenceBelongsToRun(
  reference: ArtifactReference,
  scope: AppScope,
  runId: string,
): boolean {
  return scopesMatch(reference, scope) && reference.run_id === runId;
}

function requireState(
  projection: RunProjection,
  states: readonly RunProjection["status"][],
  event: RunRuntimeEvent,
): void {
  if (!states.includes(projection.status)) {
    throw new RunProjectionError(
      "RUN_EVENT_TRANSITION_INVALID",
      `${event.event_type} 不能从 ${projection.status} 状态执行。`,
    );
  }
}

function requireCurrentFence(projection: RunProjection, event: RunRuntimeEvent): void {
  if (event.worker_fence !== projection.worker_fence) {
    throw new RunProjectionError(
      "RUN_EVENT_FENCE_INVALID",
      `${event.event_type} 的 Worker Fence 不是当前 Fence。`,
    );
  }
}

function requireNewFence(projection: RunProjection, event: RunRuntimeEvent): void {
  if (event.worker_fence <= projection.worker_fence) {
    throw new RunProjectionError(
      "RUN_EVENT_FENCE_INVALID",
      `${event.event_type} 必须使用更高的 Worker Fence。`,
    );
  }
}

function updateProjection(
  previous: RunProjection,
  event: RunRuntimeEvent,
  changes: Partial<RunProjection>,
): RunProjection {
  return runProjectionSchema.parse({
    ...previous,
    ...changes,
    version: event.sequence,
    worker_fence: event.worker_fence,
    last_event_id: event.event_id,
    last_occurred_at: event.occurred_at,
  });
}

export function reduceRunProjection(
  previousInput: RunProjection | null,
  eventInput: unknown,
): RunProjection {
  const event = runRuntimeEventSchema.parse(eventInput);

  if (!previousInput) {
    if (event.event_type !== "run.accepted" || event.sequence !== 1 || event.worker_fence !== 0) {
      throw new RunProjectionError(
        "RUN_EVENT_SEQUENCE_INVALID",
        "Run Projection 必须从 sequence=1、Fence=0 的 run.accepted 开始。",
      );
    }
    return deepFreeze(
      runProjectionSchema.parse({
        schema_version: "1.0.0",
        scope: event.scope,
        run_id: event.run_id,
        status: "QUEUED",
        version: 1,
        worker_fence: 0,
        attempt_count: 0,
        last_event_id: event.event_id,
        last_occurred_at: event.occurred_at,
        active_artifact_ref: null,
        active_snapshot_ref: null,
        last_side_effect_receipt_id: null,
        terminal_event_id: null,
      }),
    );
  }

  const previous = runProjectionSchema.parse(previousInput);
  if (!scopesMatch(previous.scope, event.scope) || previous.run_id !== event.run_id) {
    throw new RunProjectionError(
      "RUN_EVENT_SCOPE_MISMATCH",
      "Run Event 与现有 Projection 不属于同一 App/Tenant/Environment/Run。",
    );
  }
  if (event.sequence !== previous.version + 1) {
    throw new RunProjectionError(
      "RUN_EVENT_SEQUENCE_INVALID",
      "Run Event Sequence 必须与 Projection Version 连续。",
    );
  }
  if (event.worker_fence < previous.worker_fence) {
    throw new RunProjectionError(
      "RUN_EVENT_FENCE_INVALID",
      "过期 Worker Fence 不能推进 Run Projection。",
    );
  }
  if (previous.terminal_event_id) {
    throw new RunProjectionError(
      "RUN_EVENT_AFTER_TERMINAL",
      "Run 已进入终态，不能接受迟到 Event。",
    );
  }

  let next: RunProjection;
  switch (event.event_type) {
    case "run.accepted":
      throw new RunProjectionError(
        "RUN_EVENT_TRANSITION_INVALID",
        "同一 Run 不能接受第二个 run.accepted。",
      );
    case "run.leased":
      requireNewFence(previous, event);
      requireState(previous, ["QUEUED", "RUNNING"], event);
      if (event.payload.attempt <= previous.attempt_count) {
        throw new RunProjectionError(
          "RUN_EVENT_TRANSITION_INVALID",
          "run.leased 的 Attempt 必须严格大于已投影的 Attempt Count。",
        );
      }
      next = updateProjection(previous, event, {
        status: "RUNNING",
        attempt_count: event.payload.attempt,
      });
      break;
    case "run.checkpointed":
      requireCurrentFence(previous, event);
      requireState(previous, ["RUNNING"], event);
      next = updateProjection(previous, event, {
        active_artifact_ref: event.payload.active_artifact_ref,
        active_snapshot_ref: event.payload.snapshot_ref,
      });
      break;
    case "run.side_effect_committed":
      requireCurrentFence(previous, event);
      requireState(previous, ["RUNNING"], event);
      next = updateProjection(previous, event, {
        last_side_effect_receipt_id: event.payload.receipt_id,
      });
      break;
    case "run.suspended":
      requireCurrentFence(previous, event);
      requireState(previous, ["RUNNING"], event);
      next = updateProjection(previous, event, { status: "WAITING" });
      break;
    case "run.resumed":
      requireCurrentFence(previous, event);
      requireState(previous, ["WAITING"], event);
      next = updateProjection(previous, event, { status: "QUEUED" });
      break;
    case "run.retry_scheduled":
      requireCurrentFence(previous, event);
      requireState(previous, ["RUNNING"], event);
      next = updateProjection(previous, event, { status: "QUEUED" });
      break;
    case "run.cancel_requested":
      requireNewFence(previous, event);
      requireState(previous, ["QUEUED", "RUNNING", "WAITING"], event);
      next = updateProjection(previous, event, {
        status: "CANCELLED",
        terminal_event_id: event.event_id,
      });
      break;
    case "run.completed":
      requireCurrentFence(previous, event);
      requireState(previous, ["RUNNING"], event);
      next = updateProjection(previous, event, {
        status: "COMPLETED",
        terminal_event_id: event.event_id,
      });
      break;
    case "run.failed":
      requireCurrentFence(previous, event);
      requireState(previous, ["RUNNING"], event);
      next = updateProjection(previous, event, {
        status: "FAILED",
        terminal_event_id: event.event_id,
      });
      break;
  }

  return deepFreeze(next);
}

export function replayRunProjection(eventsInput: readonly unknown[]): RunProjection {
  if (eventsInput.length === 0) {
    throw new RunProjectionError(
      "RUN_EVENT_SEQUENCE_INVALID",
      "没有 Durable Event 不能重建 Run Projection。",
    );
  }
  let projection: RunProjection | null = null;
  for (const event of eventsInput) {
    projection = reduceRunProjection(projection, event);
  }
  if (!projection) {
    throw new RunProjectionError(
      "RUN_EVENT_SEQUENCE_INVALID",
      "没有 Durable Event 不能重建 Run Projection。",
    );
  }
  return projection;
}

export async function hashRunProjection(input: unknown): Promise<string> {
  return sha256ContentHash(runProjectionSchema.parse(input));
}

export const runCheckpointInputSchema = z.strictObject({
  workflow_id: versionIdentifierSchema,
  workflow_definition_revision: contentHashSchema,
  mastra_run_id: runtimeIdentifierSchema,
  snapshot_version: positiveSafeIntegerSchema,
  active_artifact_ref: artifactReferenceSchema.nullable(),
  mastra_snapshot: z.record(z.string(), z.json()),
});

export const mastraSnapshotBindingBodySchema = z
  .strictObject({
    schema_version: z.literal("1.0.0"),
    authority: z.literal("EXECUTION_SNAPSHOT_ONLY"),
    snapshot_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    workflow_id: versionIdentifierSchema,
    workflow_definition_revision: contentHashSchema,
    mastra_core_version: z.literal("1.52.1"),
    mastra_run_id: runtimeIdentifierSchema,
    attempt_id: immutableIdSchema,
    snapshot_version: positiveSafeIntegerSchema,
    event_sequence: positiveSafeIntegerSchema,
    worker_fence: nonNegativeSafeIntegerSchema,
    active_artifact_ref: artifactReferenceSchema.nullable(),
    mastra_snapshot: z.record(z.string(), z.json()),
    created_at: runtimeTimestampSchema,
  })
  .superRefine((binding, ctx) => {
    if (
      binding.active_artifact_ref &&
      !referenceBelongsToRun(binding.active_artifact_ref, binding.scope, binding.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Mastra Snapshot 的 Active Artifact 必须属于同一 Run。",
        path: ["active_artifact_ref"],
      });
    }
    if (binding.mastra_snapshot.runId !== binding.mastra_run_id) {
      ctx.addIssue({
        code: "custom",
        message: "Mastra Snapshot 内部 runId 必须匹配 mastra_run_id。",
        path: ["mastra_snapshot", "runId"],
      });
    }
  });

export const mastraSnapshotBindingSchema = mastraSnapshotBindingBodySchema.safeExtend({
  snapshot_hash: contentHashSchema,
});

/**
 * Computes the TypeScript-local binding hash used by non-PostgreSQL adapters.
 * PostgreSQL adapters must propagate the authoritative binding returned by
 * commitSnapshot instead of comparing this digest with the database digest.
 */
export async function computeMastraSnapshotBindingHash(input: unknown): Promise<string> {
  return sha256ContentHash(mastraSnapshotBindingBodySchema.parse(input));
}

export const sideEffectReceiptSchema = z
  .strictObject({
    schema_version: z.literal("1.0.0"),
    receipt_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    effect_kind: z.enum(["SQL", "EVAL"]),
    input_hash: contentHashSchema,
    output_hash: contentHashSchema,
    worker_fence: nonNegativeSafeIntegerSchema,
    artifact_ref: artifactReferenceSchema.optional(),
    committed_at: runtimeTimestampSchema,
  })
  .superRefine((receipt, ctx) => {
    if (
      receipt.artifact_ref &&
      !referenceBelongsToRun(receipt.artifact_ref, receipt.scope, receipt.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Side Effect Receipt 的 Artifact 必须属于同一 Run。",
        path: ["artifact_ref"],
      });
    }
  });

export const runWorkLeaseSchema = z.strictObject({
  scope: appScopeSchema,
  outbox_id: immutableIdSchema,
  run_id: immutableIdSchema,
  command_id: immutableIdSchema,
  command_kind: z.enum(["START_L2_RESEARCH", "RESUME_RUN"]),
  attempt_id: immutableIdSchema,
  attempt_no: positiveSafeIntegerSchema,
  delivery_attempt_no: positiveSafeIntegerSchema,
  lease_duration_ms: runLeaseDurationMsSchema,
  worker_id: runtimeIdentifierSchema,
  lease_token: positiveSafeIntegerSchema,
  worker_fence: positiveSafeIntegerSchema,
  expires_at: runtimeTimestampSchema,
  payload: z.record(z.string(), z.json()),
});

export const runControlCommandSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  operation: z.enum(["CANCEL", "RESUME"]),
  run_id: immutableIdSchema,
  command_id: immutableIdSchema,
  event_id: immutableIdSchema,
  outbox_id: immutableIdSchema,
  audit_id: immutableIdSchema,
  idempotency_key: eventIdempotencyKeySchema,
  occurred_at: runtimeTimestampSchema,
});

export type RunProjectionRecord = Readonly<{
  projection: RunProjection;
  projection_hash: string;
}>;
export const runProjectionRecordSchema = z.strictObject({
  projection: runProjectionSchema,
  projection_hash: contentHashSchema,
});

export interface RunQueuePort {
  lease(input: {
    readonly scope: AppScope;
    readonly worker_id: string;
  }): Promise<PortResult<RunWorkLease | null>>;
  heartbeat(input: {
    readonly lease: RunWorkLease;
  }): Promise<PortResult<{ readonly expires_at: string }>>;
  complete(input: {
    readonly lease: RunWorkLease;
    readonly final_event_sequence: number;
  }): Promise<PortResult<{ readonly acknowledged: true }>>;
  retry(input: {
    readonly lease: RunWorkLease;
    readonly final_event_sequence: number;
    readonly error_code: string;
    readonly retry_delay_ms: number;
  }): Promise<PortResult<{ readonly released: true }>>;
}

export interface RunEventStorePort {
  readProjection(input: {
    readonly scope: AppScope;
    readonly run_id: string;
  }): Promise<PortResult<RunProjectionRecord | null>>;
  append(input: {
    readonly lease: RunWorkLease;
    readonly event: WorkerRunRuntimeEvent;
    readonly expected_projection: RunProjectionRecord;
  }): Promise<
    PortResult<
      Readonly<{
        replayed: boolean;
        event: RunRuntimeEvent;
        projection: RunProjection;
        projection_hash: string;
      }>
    >
  >;
  listEvents(input: {
    readonly scope: AppScope;
    readonly run_id: string;
    readonly after_sequence?: number;
    readonly limit?: number;
  }): Promise<PortResult<readonly RunRuntimeEvent[]>>;
  findEventByIdempotencyKey(input: {
    readonly scope: AppScope;
    readonly run_id: string;
    readonly idempotency_key: string;
  }): Promise<PortResult<RunRuntimeEvent | null>>;
  commitSnapshot(input: {
    readonly lease: RunWorkLease;
    readonly binding: MastraSnapshotBindingBody;
  }): Promise<
    PortResult<{
      readonly created: boolean;
      readonly binding: MastraSnapshotBinding;
    }>
  >;
  loadLatestSnapshot(input: {
    readonly scope: AppScope;
    readonly run_id: string;
  }): Promise<PortResult<MastraSnapshotBinding | null>>;
  findSideEffect(input: {
    readonly scope: AppScope;
    readonly run_id: string;
    readonly effect_kind: SideEffectReceipt["effect_kind"];
    readonly input_hash: string;
  }): Promise<PortResult<SideEffectReceipt | null>>;
  commitSideEffect(input: {
    readonly lease: RunWorkLease;
    readonly receipt: SideEffectReceipt;
  }): Promise<PortResult<{ readonly created: boolean; readonly receipt: SideEffectReceipt }>>;
}

export interface RunControlPort {
  submit(input: RunControlCommand): Promise<
    PortResult<
      Readonly<{
        replayed: boolean;
        command_id: string;
        projection: RunProjection;
        projection_hash: string;
      }>
    >
  >;
}

export type RunRuntimeEvent = z.infer<typeof runRuntimeEventSchema>;
export type WorkerRunRuntimeEvent = z.infer<typeof workerRunRuntimeEventSchema>;
export type RunProjection = z.infer<typeof runProjectionSchema>;
export type MastraSnapshotBindingBody = z.infer<typeof mastraSnapshotBindingBodySchema>;
export type MastraSnapshotBinding = z.infer<typeof mastraSnapshotBindingSchema>;
export type SideEffectReceipt = z.infer<typeof sideEffectReceiptSchema>;
export type RunWorkLease = z.infer<typeof runWorkLeaseSchema>;
export type RunControlCommand = z.infer<typeof runControlCommandSchema>;
