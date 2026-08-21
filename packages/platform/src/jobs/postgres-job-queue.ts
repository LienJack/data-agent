import {
  type AppScope,
  appScopeSchema,
  JOB_KINDS,
  type JobQueuePort,
  type JobSubmissionCommand,
  type JobWorkerHeartbeat,
  jobHandlerBindingSchema,
  jobIdempotencyKeySchema,
  jobRecordSchema,
  jobRuntimeIdentifierSchema,
  jobWorkLeaseSchema,
  verifyCapabilityReadinessReceipt,
  verifyJobOutputReceipt,
  verifyJobSubmissionCommand,
  verifyJobSubmissionReceipt,
  verifyJobWorkerHeartbeat,
  verifyJobWorkLease,
} from "@data-agent/contracts";
import { z } from "zod";
import { mapDatabaseRuntimeFailure } from "../persistence/runtime-database-errors.js";
import {
  type AppTransactionContext,
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const JOB_DATABASE_FAILURES = Object.freeze({
  JOB_IDEMPOTENCY_CONFLICT: {
    code: "JOB_IDEMPOTENCY_CONFLICT",
    message: "同一 Job Idempotency Key 已绑定不同请求。",
    retryable: false,
  },
  JOB_WORKER_HEARTBEAT_STALE: {
    code: "JOB_WORKER_HEARTBEAT_STALE",
    message: "Job Worker Heartbeat 已过期或 Handler 集不一致。",
    retryable: true,
  },
  JOB_WORKER_HEARTBEAT_REPLAY_CONFLICT: {
    code: "JOB_WORKER_HEARTBEAT_CONFLICT",
    message: "Job Worker Heartbeat Identity 已绑定不同内容。",
    retryable: false,
  },
  JOB_WORK_LEASE_STALE: {
    code: "JOB_WORK_LEASE_STALE",
    message: "Job Lease 已过期或 Fence 已失效。",
    retryable: false,
  },
  JOB_CANCEL_NOT_SUPPORTED: {
    code: "JOB_CANCEL_NOT_SUPPORTED",
    message: "该 Job Handler 不支持取消。",
    retryable: false,
  },
  JOB_ARTIFACT_NOT_COMMITTED: {
    code: "JOB_ARTIFACT_NOT_COMMITTED",
    message: "Job 输出或输入引用的 Artifact 尚未提交或不属于当前 Scope。",
    retryable: false,
  },
  JOB_ARTIFACT_REFERENCES_NOT_CANONICAL: {
    code: "JOB_ARTIFACT_REFERENCES_NOT_CANONICAL",
    message: "Job Artifact 引用未按完整身份规范排序。",
    retryable: false,
  },
  JOB_OUTPUT_REFERENCE_DUPLICATE: {
    code: "JOB_OUTPUT_REFERENCE_DUPLICATE",
    message: "Job Artifact 引用不得重复。",
    retryable: false,
  },
} as const);

function mapJobDatabaseFailure(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const failure = JOB_DATABASE_FAILURES[error.message as keyof typeof JOB_DATABASE_FAILURES];
    if (failure) return { ok: false as const, error: failure };
    if (/^JOB_[A-Z0-9_]+$/.test(error.message)) {
      return {
        ok: false as const,
        error: {
          code: error.message,
          message: "Job Authority 拒绝了当前操作。",
          retryable: false,
        },
      };
    }
  }
  return mapDatabaseRuntimeFailure(error);
}

const uuidSchema = z.string().uuid();
const errorCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);
const heartbeatResultSchema = z.strictObject({
  expires_at: z.string().datetime({ offset: true }),
  cancel_requested: z.boolean(),
});

function invalidInput(message: string) {
  return {
    ok: false as const,
    error: { code: "JOB_QUEUE_INPUT_INVALID", message, retryable: false },
  };
}

function assertScope(requested: AppScope, authorized: AppScope): void {
  if (
    requested.app_id !== authorized.app_id ||
    requested.tenant_id !== authorized.tenant_id ||
    requested.environment !== authorized.environment
  ) {
    throw new PersistenceBoundaryError(
      "JOB_QUEUE_SCOPE_DENIED",
      "Job Queue 请求不能替换服务端授权的 Scope。",
    );
  }
}

function assertPrincipal(requested: string, authorized: string): void {
  if (requested !== authorized) {
    throw new PersistenceBoundaryError(
      "JOB_QUEUE_PRINCIPAL_DENIED",
      "Job Queue Lease 的 Principal 与当前 Authority 不一致。",
    );
  }
}

async function verifyRecord(input: unknown) {
  const record = jobRecordSchema.parse(input);
  if (record.output_receipt) await verifyJobOutputReceipt(record.output_receipt);
  return record;
}

export function createPostgresJobQueue(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
  capabilityInput: unknown,
  options: { readonly lease_duration_ms: number },
): JobQueuePort {
  if (
    !Number.isSafeInteger(options.lease_duration_ms) ||
    options.lease_duration_ms < 5_000 ||
    options.lease_duration_ms > 900_000
  ) {
    throw new TypeError("Job Queue Lease Duration 必须在 5 秒到 15 分钟之间。");
  }

  const transact = <T>(
    access: "READ" | "WRITE",
    operation: string,
    correlationId: string,
    callback: (context: AppTransactionContext) => Promise<T>,
  ) =>
    withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      {
        access,
        map_database_error: mapJobDatabaseFailure,
        operation_name: operation,
        correlation_id: correlationId,
      },
      callback,
    );

  return {
    async enqueue(commandInput) {
      let command: JobSubmissionCommand;
      try {
        command = await verifyJobSubmissionCommand(commandInput);
      } catch {
        return invalidInput("Job Submission Command 不符合契约。");
      }
      return transact(
        "WRITE",
        "job_queue.enqueue",
        command.idempotency_key,
        async ({ capability, client }) => {
          assertScope(command.scope, capability.scope);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.enqueue_job($1::jsonb) as value",
            [command],
          );
          return verifyJobSubmissionReceipt(result.rows[0]?.value);
        },
      );
    },

    async claim(input) {
      const scope = appScopeSchema.safeParse(input.scope);
      const worker = jobRuntimeIdentifierSchema.safeParse(input.worker_id);
      const handlers = z
        .array(jobHandlerBindingSchema)
        .min(1)
        .max(JOB_KINDS.length)
        .safeParse(input.handlers);
      if (!scope.success || !worker.success || !handlers.success) {
        return invalidInput("Job Claim 输入不符合契约。");
      }
      return transact("WRITE", "job_queue.claim", worker.data, async ({ capability, client }) => {
        assertScope(scope.data, capability.scope);
        const result = await client.query<{ value: unknown }>(
          "select app_data_agent.claim_job_work($1::text,$2::jsonb,$3::integer) as value",
          [worker.data, JSON.stringify(handlers.data), options.lease_duration_ms],
        );
        return result.rows[0]?.value === null || result.rows[0]?.value === undefined
          ? null
          : verifyJobWorkLease(result.rows[0].value);
      });
    },

    async start({ lease }) {
      const parsed = jobWorkLeaseSchema.safeParse(lease);
      if (!parsed.success) return invalidInput("Job Start Lease 不符合契约。");
      return transact(
        "WRITE",
        "job_queue.start",
        parsed.data.job_id,
        async ({ capability, client }) => {
          assertScope(parsed.data.scope, capability.scope);
          assertPrincipal(parsed.data.principal_id, capability.principal);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.start_job_work($1::jsonb) as value",
            [parsed.data],
          );
          return z.strictObject({ started: z.literal(true) }).parse(result.rows[0]?.value);
        },
      );
    },

    async heartbeat({ lease }) {
      const parsed = jobWorkLeaseSchema.safeParse(lease);
      if (!parsed.success) return invalidInput("Job Heartbeat Lease 不符合契约。");
      return transact(
        "WRITE",
        "job_queue.heartbeat",
        parsed.data.job_id,
        async ({ capability, client }) => {
          assertScope(parsed.data.scope, capability.scope);
          assertPrincipal(parsed.data.principal_id, capability.principal);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.heartbeat_job_work($1::jsonb,$2::integer) as value",
            [parsed.data, options.lease_duration_ms],
          );
          return heartbeatResultSchema.parse(result.rows[0]?.value);
        },
      );
    },

    async succeed({ lease, output_refs }) {
      const parsed = jobWorkLeaseSchema.safeParse(lease);
      if (!parsed.success) return invalidInput("Job Success Lease 不符合契约。");
      return transact(
        "WRITE",
        "job_queue.succeed",
        parsed.data.job_id,
        async ({ capability, client }) => {
          assertScope(parsed.data.scope, capability.scope);
          assertPrincipal(parsed.data.principal_id, capability.principal);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.succeed_job_work($1::jsonb,$2::jsonb) as value",
            [parsed.data, output_refs],
          );
          return verifyJobOutputReceipt(result.rows[0]?.value);
        },
      );
    },

    async fail({ lease, error_code, retryable, retry_delay_ms }) {
      const parsed = jobWorkLeaseSchema.safeParse(lease);
      const error = errorCodeSchema.safeParse(error_code);
      if (!parsed.success || !error.success) return invalidInput("Job Failure 输入不符合契约。");
      return transact(
        "WRITE",
        "job_queue.fail",
        parsed.data.job_id,
        async ({ capability, client }) => {
          assertScope(parsed.data.scope, capability.scope);
          assertPrincipal(parsed.data.principal_id, capability.principal);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.fail_job_work($1::jsonb,$2::text,$3::boolean,$4::integer) as value",
            [parsed.data, error.data, retryable, retry_delay_ms],
          );
          return result.rows[0]?.value === null || result.rows[0]?.value === undefined
            ? null
            : verifyJobOutputReceipt(result.rows[0].value);
        },
      );
    },

    async acknowledgeCancel({ lease, error_code }) {
      const parsed = jobWorkLeaseSchema.safeParse(lease);
      const error = errorCodeSchema.safeParse(error_code);
      if (!parsed.success || !error.success) return invalidInput("Job Cancel ACK 不符合契约。");
      return transact(
        "WRITE",
        "job_queue.cancel_ack",
        parsed.data.job_id,
        async ({ capability, client }) => {
          assertScope(parsed.data.scope, capability.scope);
          assertPrincipal(parsed.data.principal_id, capability.principal);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.acknowledge_job_cancel($1::jsonb,$2::text) as value",
            [parsed.data, error.data],
          );
          return verifyJobOutputReceipt(result.rows[0]?.value);
        },
      );
    },

    async requestCancel(input) {
      const scope = appScopeSchema.safeParse(input.scope);
      const jobId = uuidSchema.safeParse(input.job_id);
      const key = jobIdempotencyKeySchema.safeParse(input.idempotency_key);
      if (!scope.success || !jobId.success || !key.success)
        return invalidInput("Job Cancel 输入不符合契约。");
      return transact("WRITE", "job_queue.cancel", jobId.data, async ({ capability, client }) => {
        assertScope(scope.data, capability.scope);
        const result = await client.query<{ value: unknown }>(
          "select app_data_agent.request_job_cancel($1::uuid,$2::text) as value",
          [jobId.data, key.data],
        );
        return verifyRecord(result.rows[0]?.value);
      });
    },

    async get(input) {
      const scope = appScopeSchema.safeParse(input.scope);
      const jobId = uuidSchema.safeParse(input.job_id);
      if (!scope.success || !jobId.success) return invalidInput("Job Get 输入不符合契约。");
      return transact("READ", "job_queue.get", jobId.data, async ({ capability, client }) => {
        assertScope(scope.data, capability.scope);
        const result = await client.query<{ value: unknown }>(
          "select app_data_agent.get_job($1::uuid) as value",
          [jobId.data],
        );
        return result.rows[0]?.value === null || result.rows[0]?.value === undefined
          ? null
          : verifyRecord(result.rows[0].value);
      });
    },

    async list(input) {
      const scope = appScopeSchema.safeParse(input.scope);
      const after =
        input.after_job_id === undefined ? null : uuidSchema.safeParse(input.after_job_id);
      const limit = z
        .number()
        .int()
        .min(1)
        .max(100)
        .safeParse(input.limit ?? 50);
      if (!scope.success || (after !== null && !after.success) || !limit.success)
        return invalidInput("Job List 输入不符合契约。");
      return transact(
        "READ",
        "job_queue.list",
        scope.data.tenant_id,
        async ({ capability, client }) => {
          assertScope(scope.data, capability.scope);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.list_jobs($1::uuid,$2::integer) as value",
            [after === null ? null : after.data, limit.data],
          );
          const records = z.array(jobRecordSchema).parse(result.rows[0]?.value);
          return Promise.all(records.map(verifyRecord));
        },
      );
    },

    async publishHeartbeat(input) {
      let heartbeat: JobWorkerHeartbeat;
      try {
        heartbeat = await verifyJobWorkerHeartbeat(input);
      } catch {
        return invalidInput("Job Worker Heartbeat 不符合契约。");
      }
      return transact(
        "WRITE",
        "job_queue.worker_heartbeat",
        heartbeat.worker_id,
        async ({ capability, client }) => {
          assertScope(heartbeat.scope, capability.scope);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.publish_job_worker_heartbeat($1::jsonb) as value",
            [heartbeat],
          );
          return verifyJobWorkerHeartbeat(result.rows[0]?.value);
        },
      );
    },

    async listReadiness({ scope: scopeInput }) {
      const scope = appScopeSchema.safeParse(scopeInput);
      if (!scope.success) return invalidInput("Job Readiness Scope 不符合契约。");
      return transact(
        "READ",
        "job_queue.readiness",
        scope.data.tenant_id,
        async ({ capability, client }) => {
          assertScope(scope.data, capability.scope);
          const result = await client.query<{ value: unknown }>(
            "select app_data_agent.list_job_capability_readiness() as value",
          );
          const receipts = z.array(z.unknown()).parse(result.rows[0]?.value);
          return Promise.all(receipts.map(verifyCapabilityReadinessReceipt));
        },
      );
    },
  };
}
