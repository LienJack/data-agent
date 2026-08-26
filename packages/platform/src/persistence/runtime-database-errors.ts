import type { PortResult } from "@data-agent/contracts";

interface DatabaseRuntimeFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

const DATABASE_RUNTIME_FAILURES: Readonly<Record<string, DatabaseRuntimeFailure>> = Object.freeze({
  DA_COMMAND_IDEMPOTENCY_CONFLICT: {
    code: "COMMAND_IDEMPOTENCY_CONFLICT",
    message: "同一 Idempotency Key 已绑定不同 Command、Run、Question 或 Payload。",
    retryable: false,
  },
  DA_COMMAND_IDENTITY_CONFLICT: {
    code: "COMMAND_IDEMPOTENCY_CONFLICT",
    message: "Command、Run、Event 或 Outbox Identity 已绑定其他请求。",
    retryable: false,
  },
  DA_RUN_ALREADY_EXISTS: {
    code: "RUN_ALREADY_EXISTS",
    message: "Run ID 已存在，不能附带另一个初始 Command。",
    retryable: false,
  },
  DA_RUN_PROJECTION_CONFLICT: {
    code: "RUN_PROJECTION_CONFLICT",
    message: "Run Projection 已变化，调用方必须重放后再提交。",
    retryable: true,
  },
  DA_RUN_CONTROL_PROJECTION_CONFLICT: {
    code: "RUN_PROJECTION_CONFLICT",
    message: "Run Projection 已变化，控制命令必须重放后再提交。",
    retryable: true,
  },
  DA_RUN_EVENT_SEQUENCE_INVALID: {
    code: "RUN_PROJECTION_CONFLICT",
    message: "Run Event Sequence 已变化，调用方必须重放后再提交。",
    retryable: true,
  },
  DA_RUN_EVENT_FENCE_STALE: {
    code: "RUN_COMMIT_CANCELLED_OR_STALE",
    message: "Run 已取消、进入终态或 Worker Fence 已过期，拒绝迟到提交。",
    retryable: false,
  },
  DA_RUN_EVENT_LEASE_STALE: {
    code: "RUN_COMMIT_CANCELLED_OR_STALE",
    message: "Run Lease 已过期，拒绝迟到提交。",
    retryable: false,
  },
  DA_RUN_CHECKPOINT_STALE_FENCE: {
    code: "RUN_COMMIT_CANCELLED_OR_STALE",
    message: "Run Checkpoint 的 Worker Fence 已过期，拒绝迟到提交。",
    retryable: false,
  },
  DA_RUN_CHECKPOINT_STALE_LEASE: {
    code: "RUN_COMMIT_CANCELLED_OR_STALE",
    message: "Run Checkpoint 的完整 Lease 已过期，拒绝迟到提交。",
    retryable: false,
  },
  DA_RUN_EFFECT_STALE_FENCE: {
    code: "RUN_COMMIT_CANCELLED_OR_STALE",
    message: "Run Side Effect 的 Worker Fence 已过期，拒绝迟到提交。",
    retryable: false,
  },
  DA_RUN_EFFECT_STALE_LEASE: {
    code: "RUN_COMMIT_CANCELLED_OR_STALE",
    message: "Run Side Effect 的完整 Lease 已过期，拒绝迟到提交。",
    retryable: false,
  },
  DA_RUN_EVENT_AFTER_TERMINAL: {
    code: "RUN_COMMIT_CANCELLED_OR_STALE",
    message: "Run 已进入终态，拒绝迟到提交。",
    retryable: false,
  },
  DA_RUN_LEASE_STALE: {
    code: "RUN_QUEUE_STALE_FENCE",
    message: "Run Queue Lease 已过期或 Fence 已失效。",
    retryable: false,
  },
  DA_RUN_WORK_CLAIM_CONFLICT: {
    code: "RUN_QUEUE_STALE_FENCE",
    message: "Run Work Claim 已被其他 Worker 推进。",
    retryable: true,
  },
  DA_RUN_EVENT_IDEMPOTENCY_CONFLICT: {
    code: "RUN_EVENT_IDEMPOTENCY_CONFLICT",
    message: "Run Event Idempotency Key 已绑定不同规范事件。",
    retryable: false,
  },
  DA_RUN_CONTROL_IDEMPOTENCY_CONFLICT: {
    code: "RUN_CONTROL_IDEMPOTENCY_CONFLICT",
    message: "Run Control Idempotency Key 或 Event ID 已绑定其他控制命令。",
    retryable: false,
  },
  DA_RUN_CONTROL_STATE_INVALID: {
    code: "RUN_CONTROL_STATE_INVALID",
    message: "Run 当前状态或 Fence 不允许执行该控制命令。",
    retryable: false,
  },
  DA_RUN_CHECKPOINT_IDEMPOTENCY_CONFLICT: {
    code: "RUN_CHECKPOINT_CONFLICT",
    message: "Run Checkpoint 内容键已绑定不同 Snapshot。",
    retryable: false,
  },
  DA_RUN_CHECKPOINT_ARTIFACT_INVALID: {
    code: "RUN_CHECKPOINT_ARTIFACT_INVALID",
    message: "Run Checkpoint 引用的 Active Artifact 无效。",
    retryable: false,
  },
  DA_RUN_EFFECT_IDEMPOTENCY_CONFLICT: {
    code: "RUN_EFFECT_RECEIPT_CONFLICT",
    message: "Run Side Effect 内容键已绑定不同 Receipt。",
    retryable: false,
  },
  DA_RUN_EFFECT_ARTIFACT_INVALID: {
    code: "RUN_EFFECT_ARTIFACT_INVALID",
    message: "Run Side Effect Receipt 引用的 Artifact 无效。",
    retryable: false,
  },
  DA_RUN_EVENT_HASH_MISMATCH: {
    code: "RUN_RUNTIME_HASH_MISMATCH",
    message: "Run Event Content Hash 与数据库复算结果不一致。",
    retryable: false,
  },
  DA_RUN_PROJECTION_HASH_MISMATCH: {
    code: "RUN_RUNTIME_HASH_MISMATCH",
    message: "Run Projection Content Hash 与数据库复算结果不一致。",
    retryable: false,
  },
  DA_RUN_CHECKPOINT_HASH_MISMATCH: {
    code: "RUN_RUNTIME_HASH_MISMATCH",
    message: "Run Checkpoint Content Hash 与数据库复算结果不一致。",
    retryable: false,
  },
  DA_RUN_EVENT_TRANSITION_INVALID: {
    code: "RUN_RUNTIME_INVARIANT_VIOLATION",
    message: "Run Event 不满足数据库权威状态机。",
    retryable: false,
  },
  DA_RUN_PROJECTION_SEMANTIC_MISMATCH: {
    code: "RUN_RUNTIME_INVARIANT_VIOLATION",
    message: "Run Projection 与数据库权威 Reducer 结果不一致。",
    retryable: false,
  },
  DA_RUN_ATTEMPT_BUDGET_PROJECTION_CONFLICT: {
    code: "RUN_RUNTIME_INVARIANT_VIOLATION",
    message: "Attempt Budget 结算时发现 Run Projection 不一致。",
    retryable: false,
  },
  RUN_EXECUTION_POLICY_CORRUPT: {
    code: "RUN_QUEUE_DATABASE_CONTRACT_INVALID",
    message: "Run Queue 读取到损坏或不完整的执行策略。",
    retryable: false,
  },
});

export function mapDatabaseRuntimeFailure(error: unknown): PortResult<never> | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("message" in error) ||
    typeof error.message !== "string"
  ) {
    return null;
  }

  const failure = DATABASE_RUNTIME_FAILURES[error.message];
  return failure ? { ok: false, error: failure } : null;
}
