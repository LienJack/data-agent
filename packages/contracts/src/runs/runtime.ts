import { z } from "zod";
import { agentProfileIdSchema } from "../agents/subagent-discovery.js";
import { type ArtifactReference, artifactReferenceSchema } from "../artifacts/envelope.js";
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
import {
  falcon24AcceptanceCampaignIdSchema,
  falcon24AnalysisCaseIdSchema,
} from "../evals/index.js";

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
export const DEFAULT_RUN_EXECUTION_POLICY = Object.freeze({
  schema_version: "run-execution-policy@1.0.0" as const,
  acceptance_authority_kind: null,
  campaign_id: null,
  case_id: null,
  run_variant: null,
  repetition: null,
  policy_id: "default-run-retry@1.0.0" as const,
  mode: "DEFAULT" as const,
  max_run_attempts: RUN_RETRY_MAX_ATTEMPTS,
  max_provider_attempts_per_call: 2 as const,
  max_root_turns: 2 as const,
  max_text2sql_candidate_attempts: 2 as const,
  analysis_repair_budget_per_category: 1 as const,
  max_file_transfer_attempts: 5 as const,
  allow_stage_recovery: true,
  hold_on_failure: false,
});
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

const runtimeEventV2Fields = {
  ...runtimeEventFields,
  schema_version: z.literal("run-runtime-event@2.0.0"),
} as const;

const displayTextSchema = z.string().trim().min(1).max(100_000);
const displayCallIdSchema = z.string().trim().min(1).max(256);

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

export const snapshotReferenceSchema = z.strictObject({
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

const runProgressEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.progress"),
  payload: z.strictObject({
    phase: runtimeIdentifierSchema,
    title: z.string().trim().min(1).max(128),
    summary: displayTextSchema,
    status: z.enum(["RUNNING", "COMPLETED"]),
  }),
});

const runToolStartedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.tool_started"),
  payload: z.strictObject({
    call_id: displayCallIdSchema,
    tool_name: versionIdentifierSchema,
    title: z.string().trim().min(1).max(128),
    summary: displayTextSchema,
    input: z.string().max(100_000).nullable(),
  }),
});

const runToolCompletedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.tool_completed"),
  payload: z.strictObject({
    call_id: displayCallIdSchema,
    tool_name: versionIdentifierSchema,
    summary: displayTextSchema,
    output: z.string().max(200_000).nullable(),
    duration_ms: nonNegativeSafeIntegerSchema,
  }),
});

const runToolFailedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.tool_failed"),
  payload: z.strictObject({
    call_id: displayCallIdSchema,
    tool_name: versionIdentifierSchema,
    summary: displayTextSchema,
    error_code: runtimeIdentifierSchema,
    output: z.string().max(200_000).nullable(),
    duration_ms: nonNegativeSafeIntegerSchema,
  }),
});

const toolAgentIdentityFields = {
  profile_id: agentProfileIdSchema.nullable(),
  task_id: immutableIdSchema.nullable(),
} as const;

const toolArtifactFields = {
  artifact_refs: z.array(artifactReferenceSchema).max(32),
} as const;

const runToolStartedV2EventSchema = z.strictObject({
  ...runtimeEventV2Fields,
  event_type: z.literal("run.tool_started"),
  payload: z.strictObject({
    call_id: displayCallIdSchema,
    tool_name: versionIdentifierSchema,
    title: z.string().trim().min(1).max(128),
    summary: displayTextSchema,
    input: z.string().max(100_000).nullable(),
    ...toolAgentIdentityFields,
    ...toolArtifactFields,
  }),
});

const runToolCompletedV2EventSchema = z.strictObject({
  ...runtimeEventV2Fields,
  event_type: z.literal("run.tool_completed"),
  payload: z.strictObject({
    call_id: displayCallIdSchema,
    tool_name: versionIdentifierSchema,
    summary: displayTextSchema,
    output: z.string().max(200_000).nullable(),
    duration_ms: nonNegativeSafeIntegerSchema,
    ...toolAgentIdentityFields,
    ...toolArtifactFields,
  }),
});

const runToolFailedV2EventSchema = z.strictObject({
  ...runtimeEventV2Fields,
  event_type: z.literal("run.tool_failed"),
  payload: z.strictObject({
    call_id: displayCallIdSchema,
    tool_name: versionIdentifierSchema,
    summary: displayTextSchema,
    error_code: runtimeIdentifierSchema,
    output: z.string().max(200_000).nullable(),
    duration_ms: nonNegativeSafeIntegerSchema,
    ...toolAgentIdentityFields,
    ...toolArtifactFields,
  }),
});

export const runAgentStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "INTERRUPTED",
  "SKIPPED",
  "BLOCKED",
]);

const runAgentStatusEventSchema = z.strictObject({
  ...runtimeEventV2Fields,
  event_type: z.literal("run.agent_status"),
  payload: z.strictObject({
    profile_id: agentProfileIdSchema,
    task_id: immutableIdSchema.nullable(),
    status: runAgentStatusSchema,
    phase: runtimeIdentifierSchema,
    title: z.string().trim().min(1).max(128),
    summary: displayTextSchema,
    duration_ms: nonNegativeSafeIntegerSchema.nullable(),
    error_code: runtimeIdentifierSchema.nullable(),
  }),
});

const runAnswerDeltaEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.answer_delta"),
  payload: z.strictObject({
    delta: z.string().min(1).max(100_000),
  }),
});

const runReasoningStartedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.reasoning_started"),
  payload: z.strictObject({
    block_id: displayCallIdSchema,
    title: z.string().trim().min(1).max(128),
  }),
});

const runReasoningDeltaEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.reasoning_delta"),
  payload: z.strictObject({
    block_id: displayCallIdSchema,
    delta: z.string().min(1).max(4_096),
  }),
});

const runReasoningCompletedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.reasoning_completed"),
  payload: z.strictObject({
    block_id: displayCallIdSchema,
    summary: displayTextSchema,
    duration_ms: nonNegativeSafeIntegerSchema,
  }),
});

const runSuspendedEventSchema = z.strictObject({
  ...runtimeEventFields,
  event_type: z.literal("run.suspended"),
  payload: z.union([
    z.strictObject({
      reason_code: runtimeIdentifierSchema,
      snapshot_id: immutableIdSchema,
    }),
    z.strictObject({
      reason_code: runtimeIdentifierSchema,
      snapshot_id: immutableIdSchema,
      interruption_id: immutableIdSchema,
      interruption_version: positiveSafeIntegerSchema,
    }),
  ]),
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

const runRuntimeEventV1Schema = z.discriminatedUnion("event_type", [
  runAcceptedEventSchema,
  runLeasedEventSchema,
  runCheckpointedEventSchema,
  runSideEffectCommittedEventSchema,
  runProgressEventSchema,
  runToolStartedEventSchema,
  runToolCompletedEventSchema,
  runToolFailedEventSchema,
  runAnswerDeltaEventSchema,
  runReasoningStartedEventSchema,
  runReasoningDeltaEventSchema,
  runReasoningCompletedEventSchema,
  runSuspendedEventSchema,
  runResumedEventSchema,
  runRetryScheduledEventSchema,
  runCancelRequestedEventSchema,
  runCompletedEventSchema,
  runFailedEventSchema,
]);

const runRuntimeEventV2Schema = z.union([
  runToolStartedV2EventSchema,
  runToolCompletedV2EventSchema,
  runToolFailedV2EventSchema,
  runAgentStatusEventSchema,
]);

function validateRuntimeEventRelationships(
  event: z.infer<typeof runRuntimeEventV1Schema> | z.infer<typeof runRuntimeEventV2Schema>,
  ctx: z.RefinementCtx,
): void {
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
  if (
    event.schema_version === "run-runtime-event@2.0.0" &&
    (event.event_type === "run.tool_started" ||
      event.event_type === "run.tool_completed" ||
      event.event_type === "run.tool_failed")
  ) {
    const { profile_id, task_id, artifact_refs } = event.payload;
    if ((profile_id === null) !== (task_id === null)) {
      ctx.addIssue({
        code: "custom",
        message: "Tool 的 profile_id 与 task_id 必须同时为空或同时存在。",
        path: ["payload", "profile_id"],
      });
    }
    if (event.event_type === "run.tool_started" && artifact_refs.length !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "Tool START 不能提前声明 ArtifactReference。",
        path: ["payload", "artifact_refs"],
      });
    }
    artifact_refs.forEach((reference, index) => {
      if (!referenceBelongsToRun(reference, event.scope, event.run_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Tool ArtifactReference 必须属于同一 App/Tenant/Environment/Run。",
          path: ["payload", "artifact_refs", index],
        });
      }
    });
  }
  if (
    event.schema_version === "run-runtime-event@2.0.0" &&
    event.event_type === "run.agent_status" &&
    event.payload.task_id === null &&
    event.payload.status !== "PENDING"
  ) {
    ctx.addIssue({
      code: "custom",
      message: "只有 PENDING Agent 状态允许 task_id 为空。",
      path: ["payload", "task_id"],
    });
  }
}

export const runRuntimeEventSchema = z
  .union([runRuntimeEventV1Schema, runRuntimeEventV2Schema])
  .superRefine(validateRuntimeEventRelationships);

const workerRunRuntimeEventV1Schema = z.discriminatedUnion("event_type", [
  runLeasedEventSchema,
  runCheckpointedEventSchema,
  runSideEffectCommittedEventSchema,
  runProgressEventSchema,
  runToolStartedEventSchema,
  runToolCompletedEventSchema,
  runToolFailedEventSchema,
  runAnswerDeltaEventSchema,
  runReasoningStartedEventSchema,
  runReasoningDeltaEventSchema,
  runReasoningCompletedEventSchema,
  runSuspendedEventSchema,
  runRetryScheduledEventSchema,
  runCompletedEventSchema,
  runFailedEventSchema,
]);

export const workerRunRuntimeEventSchema = z
  .union([workerRunRuntimeEventV1Schema, runRuntimeEventV2Schema])
  .superRefine(validateRuntimeEventRelationships);

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
    case "run.progress":
    case "run.tool_started":
    case "run.tool_completed":
    case "run.tool_failed":
    case "run.answer_delta":
    case "run.reasoning_started":
    case "run.reasoning_delta":
    case "run.reasoning_completed":
    case "run.agent_status":
      requireCurrentFence(previous, event);
      requireState(previous, ["RUNNING"], event);
      next = updateProjection(previous, event, {});
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

export const runExecutionPolicySchema = z
  .strictObject({
    schema_version: z.literal("run-execution-policy@1.0.0"),
    acceptance_authority_kind: z.enum(["CAMPAIGN", "QUALIFICATION"]).nullable(),
    campaign_id: falcon24AcceptanceCampaignIdSchema.nullable(),
    case_id: falcon24AnalysisCaseIdSchema.nullable(),
    run_variant: z.enum(["COLD", "WARM"]).nullable(),
    repetition: z.number().int().min(1).max(3).nullable(),
    policy_id: z.enum(["default-run-retry@1.0.0", "falcon24-strict-zero-retry@1.0.0"]),
    mode: z.enum(["DEFAULT", "FALCON24_STRICT"]),
    max_run_attempts: z.number().int().min(1).max(RUN_RETRY_MAX_ATTEMPTS),
    max_provider_attempts_per_call: z.union([z.literal(1), z.literal(2)]),
    max_root_turns: z.union([z.literal(1), z.literal(2)]),
    max_text2sql_candidate_attempts: z.union([z.literal(1), z.literal(2)]),
    analysis_repair_budget_per_category: z.union([z.literal(0), z.literal(1)]),
    max_file_transfer_attempts: z.number().int().min(1).max(5),
    allow_stage_recovery: z.boolean(),
    hold_on_failure: z.boolean(),
  })
  .superRefine((policy, context) => {
    const strictFalcon = policy.policy_id === "falcon24-strict-zero-retry@1.0.0";
    if (
      strictFalcon !== (policy.campaign_id !== null) ||
      strictFalcon !== (policy.acceptance_authority_kind !== null) ||
      strictFalcon !== (policy.case_id !== null) ||
      strictFalcon !== (policy.run_variant !== null) ||
      strictFalcon !== (policy.repetition !== null) ||
      strictFalcon !== policy.hold_on_failure ||
      policy.mode !== (strictFalcon ? "FALCON24_STRICT" : "DEFAULT") ||
      policy.max_run_attempts !== (strictFalcon ? 1 : RUN_RETRY_MAX_ATTEMPTS) ||
      policy.max_provider_attempts_per_call !== (strictFalcon ? 1 : 2) ||
      policy.max_root_turns !== (strictFalcon ? 1 : 2) ||
      policy.max_text2sql_candidate_attempts !== (strictFalcon ? 1 : 2) ||
      policy.analysis_repair_budget_per_category !== (strictFalcon ? 0 : 1) ||
      policy.max_file_transfer_attempts !== (strictFalcon ? 1 : 5) ||
      policy.allow_stage_recovery !== !strictFalcon
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Run execution policy identity, retry budget and HOLD behavior must close exactly.",
      });
    }
  });

export function buildFalcon24RunExecutionPolicy(input: {
  readonly acceptance_authority_kind?: "CAMPAIGN" | "QUALIFICATION";
  readonly campaign_id: string;
  readonly case_id: z.infer<typeof falcon24AnalysisCaseIdSchema>;
  readonly run_variant: "COLD" | "WARM";
  readonly repetition: number;
}): RunExecutionPolicy {
  return deepFreeze(
    runExecutionPolicySchema.parse({
      schema_version: "run-execution-policy@1.0.0",
      ...input,
      acceptance_authority_kind: input.acceptance_authority_kind ?? "CAMPAIGN",
      policy_id: "falcon24-strict-zero-retry@1.0.0",
      mode: "FALCON24_STRICT",
      max_run_attempts: 1,
      max_provider_attempts_per_call: 1,
      max_root_turns: 1,
      max_text2sql_candidate_attempts: 1,
      analysis_repair_budget_per_category: 0,
      max_file_transfer_attempts: 1,
      allow_stage_recovery: false,
      hold_on_failure: true,
    }),
  );
}

export const runWorkLeaseSchema = z.strictObject({
  scope: appScopeSchema,
  principal_id: immutableIdSchema,
  outbox_id: immutableIdSchema,
  run_id: immutableIdSchema,
  command_id: immutableIdSchema,
  command_kind: z.enum(["START_DATA_AGENT_TEAM", "START_L2_RESEARCH", "RESUME_RUN"]),
  attempt_id: immutableIdSchema,
  attempt_no: positiveSafeIntegerSchema,
  delivery_attempt_no: positiveSafeIntegerSchema,
  lease_duration_ms: runLeaseDurationMsSchema,
  worker_id: runtimeIdentifierSchema,
  lease_token: positiveSafeIntegerSchema,
  worker_fence: positiveSafeIntegerSchema,
  expires_at: runtimeTimestampSchema,
  execution_policy: runExecutionPolicySchema,
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
export type RunExecutionPolicy = z.infer<typeof runExecutionPolicySchema>;
export type RunControlCommand = z.infer<typeof runControlCommandSchema>;
