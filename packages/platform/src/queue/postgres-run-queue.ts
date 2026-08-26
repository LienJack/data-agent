import {
  type AppScope,
  appScopeSchema,
  DEFAULT_RUN_EXECUTION_POLICY,
  type PortResult,
  type RunQueuePort,
  type RunWorkLease,
  retryDelayMsSchema,
  runtimeIdentifierSchema,
  runWorkLeaseSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { mapDatabaseRuntimeFailure } from "../persistence/runtime-database-errors.js";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const finalEventSequenceSchema = z.number().int().positive().safe();
const errorCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);

interface RunWorkLeaseRow {
  readonly principal_id: string;
  readonly outbox_id: string;
  readonly run_id: string;
  readonly command_id: string;
  readonly command_kind: string;
  readonly payload_json: unknown;
  readonly attempt_id: string;
  readonly attempt_no: number;
  readonly delivery_attempt_no: number;
  readonly lease_duration_ms: number;
  readonly worker_id: string;
  readonly lease_token: string | number;
  readonly worker_fence: string | number;
  readonly lease_expires_at: Date | string;
  readonly execution_policy: unknown;
}

interface TimestampRow {
  readonly lease_expires_at: Date | string | null;
}

interface BooleanRow {
  readonly acknowledged?: boolean;
  readonly released?: boolean;
}

function invalidInput<T>(message: string): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "RUN_QUEUE_INPUT_INVALID",
      message,
      retryable: false,
    },
  };
}

function scopeMatches(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function assertScope(requested: AppScope, authorized: AppScope): void {
  if (!scopeMatches(requested, authorized)) {
    throw new PersistenceBoundaryError(
      "RUN_QUEUE_SCOPE_DENIED",
      "Run Queue 请求不能替换服务端授权的 App/Tenant/Environment Scope。",
    );
  }
}

function assertPrincipal(requested: string, authorized: string): void {
  if (requested !== authorized) {
    throw new PersistenceBoundaryError(
      "RUN_QUEUE_PRINCIPAL_DENIED",
      "Run Queue Lease 的 Principal 与当前服务端 Authority 不一致。",
    );
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function leaseFromRow(scope: AppScope, row: RunWorkLeaseRow): RunWorkLease {
  try {
    return runWorkLeaseSchema.parse({
      scope,
      principal_id: row.principal_id,
      outbox_id: row.outbox_id,
      run_id: row.run_id,
      command_id: row.command_id,
      command_kind: row.command_kind,
      attempt_id: row.attempt_id,
      attempt_no: row.attempt_no,
      delivery_attempt_no: row.delivery_attempt_no,
      lease_duration_ms: row.lease_duration_ms,
      worker_id: row.worker_id,
      lease_token: Number(row.lease_token),
      worker_fence: Number(row.worker_fence),
      expires_at: iso(row.lease_expires_at),
      execution_policy: row.execution_policy,
      payload: row.payload_json,
    });
  } catch {
    throw new PersistenceBoundaryError(
      "RUN_QUEUE_DATABASE_CONTRACT_INVALID",
      "Run Queue 返回的 exact lease execution policy 不符合冻结契约。",
    );
  }
}

export function createPostgresRunQueue(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
  capabilityInput: unknown,
  options: { readonly lease_duration_ms: number },
): RunQueuePort {
  if (
    !Number.isSafeInteger(options.lease_duration_ms) ||
    options.lease_duration_ms < 5_000 ||
    options.lease_duration_ms > 900_000
  ) {
    throw new TypeError("Run Queue Lease Duration 必须在 5 秒到 15 分钟之间。");
  }
  const leaseSeconds = Math.ceil(options.lease_duration_ms / 1_000);

  const lease: RunQueuePort["lease"] = async (input) => {
    const parsedScope = appScopeSchema.safeParse(input.scope);
    const parsedWorker = runtimeIdentifierSchema.safeParse(input.worker_id);
    if (!parsedScope.success || !parsedWorker.success) {
      return invalidInput("Run Queue Lease 输入不符合契约。");
    }

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      {
        access: "WRITE",
        map_database_error: mapDatabaseRuntimeFailure,
        operation_name: "run_queue.lease",
        correlation_id: parsedWorker.data,
      },
      async ({ capability, client }) => {
        assertScope(parsedScope.data, capability.scope);
        const result = await client.query<RunWorkLeaseRow>(
          `select
             run.principal_id,
             work.outbox_id,
             work.run_id,
             work.command_id,
             case
               when work.command_kind = 'RESUME_RUN' then original.command_kind
               else work.command_kind
             end as command_kind,
             case
               when work.command_kind = 'RESUME_RUN' then original.payload_json
               else work.payload
             end as payload_json,
             work.attempt_id,
             work.attempt_no,
             work.delivery_attempt_no,
             work.lease_duration_ms,
             work.worker_id,
             work.lease_token,
             work.worker_fence,
             work.expires_at as lease_expires_at,
             coalesce(
               app_data_agent.resolve_falcon24_run_execution_policy(run.run_id),
               $8::jsonb
             ) as execution_policy
           from app_data_agent.claim_run_work($1::text, $2::integer, $3::integer) as work
           join app_data_agent.runs as run
             on run.app_id = $4::uuid
            and run.tenant_id = $5::uuid
            and run.environment = $6::text
            and run.run_id = work.run_id
            and run.principal_id = $7::uuid
           left join lateral (
             select command.payload_json,
                    command.payload_json ->> 'kind' as command_kind
             from app_data_agent.commands as command
             where command.app_id = run.app_id
               and command.tenant_id = run.tenant_id
               and command.environment = run.environment
               and command.run_id = run.run_id
               and command.payload_json ? 'effective_config_ref'
             order by command.created_at, command.command_id
             limit 1
           ) as original on work.command_kind = 'RESUME_RUN'`,
          [
            parsedWorker.data,
            1,
            leaseSeconds,
            capability.scope.app_id,
            capability.scope.tenant_id,
            capability.scope.environment,
            capability.principal,
            DEFAULT_RUN_EXECUTION_POLICY,
          ],
        );
        const row = result.rows[0];
        return row ? leaseFromRow(capability.scope, row) : null;
      },
    );
  };

  const heartbeat: RunQueuePort["heartbeat"] = async ({ lease: leaseInput }) => {
    const parsed = runWorkLeaseSchema.safeParse(leaseInput);
    if (!parsed.success) return invalidInput("Run Queue Heartbeat Lease 不符合契约。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      {
        access: "WRITE",
        map_database_error: mapDatabaseRuntimeFailure,
        operation_name: "run_queue.heartbeat",
        correlation_id: parsed.data.outbox_id,
      },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        assertPrincipal(parsed.data.principal_id, capability.principal);
        const result = await client.query<TimestampRow>(
          `select app_data_agent.heartbeat_run_work(
             $1::uuid, $2::uuid, $3::text, $4::bigint, $5::bigint, $6::integer
           ) as lease_expires_at`,
          [
            parsed.data.outbox_id,
            parsed.data.attempt_id,
            parsed.data.worker_id,
            parsed.data.lease_token,
            parsed.data.worker_fence,
            leaseSeconds,
          ],
        );
        const expiresAt = result.rows[0]?.lease_expires_at;
        if (!expiresAt) {
          throw new PersistenceBoundaryError(
            "RUN_QUEUE_STALE_FENCE",
            "Run Queue Lease 已过期、Worker 不匹配或 Fence 已失效。",
          );
        }
        return { expires_at: iso(expiresAt) };
      },
    );
  };

  const complete: RunQueuePort["complete"] = async ({
    lease: leaseInput,
    final_event_sequence,
  }) => {
    const parsed = runWorkLeaseSchema.safeParse(leaseInput);
    const parsedSequence = finalEventSequenceSchema.safeParse(final_event_sequence);
    if (!parsed.success || !parsedSequence.success) {
      return invalidInput("Run Queue Complete 输入不符合契约。");
    }

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      {
        access: "WRITE",
        map_database_error: mapDatabaseRuntimeFailure,
        operation_name: "run_queue.complete",
        correlation_id: parsed.data.outbox_id,
      },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        assertPrincipal(parsed.data.principal_id, capability.principal);
        const result = await client.query<BooleanRow>(
          `select app_data_agent.complete_run_work(
             $1::uuid, $2::uuid, $3::text, $4::bigint, $5::bigint, $6::bigint
           ) as acknowledged`,
          [
            parsed.data.outbox_id,
            parsed.data.attempt_id,
            parsed.data.worker_id,
            parsed.data.lease_token,
            parsed.data.worker_fence,
            parsedSequence.data,
          ],
        );
        if (result.rows[0]?.acknowledged !== true) {
          throw new PersistenceBoundaryError(
            "RUN_QUEUE_STALE_FENCE",
            "过期 Worker 不能确认 Run Work。",
          );
        }
        return { acknowledged: true as const };
      },
    );
  };

  const retry: RunQueuePort["retry"] = async (input) => {
    const parsedLease = runWorkLeaseSchema.safeParse(input.lease);
    const parsedSequence = finalEventSequenceSchema.safeParse(input.final_event_sequence);
    const parsedError = errorCodeSchema.safeParse(input.error_code);
    const parsedRetryDelay = retryDelayMsSchema.safeParse(input.retry_delay_ms);
    if (
      !parsedLease.success ||
      !parsedSequence.success ||
      !parsedError.success ||
      !parsedRetryDelay.success
    ) {
      return invalidInput("Run Queue Retry 输入不符合契约。");
    }

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      {
        access: "WRITE",
        map_database_error: mapDatabaseRuntimeFailure,
        operation_name: "run_queue.retry",
        correlation_id: parsedLease.data.outbox_id,
      },
      async ({ capability, client }) => {
        assertScope(parsedLease.data.scope, capability.scope);
        assertPrincipal(parsedLease.data.principal_id, capability.principal);
        const result = await client.query<BooleanRow>(
          `select app_data_agent.retry_run_work(
             $1::uuid, $2::uuid, $3::text, $4::bigint, $5::bigint, $6::bigint,
             $7::text, $8::bigint
           ) as released`,
          [
            parsedLease.data.outbox_id,
            parsedLease.data.attempt_id,
            parsedLease.data.worker_id,
            parsedLease.data.lease_token,
            parsedLease.data.worker_fence,
            parsedSequence.data,
            parsedError.data,
            parsedRetryDelay.data,
          ],
        );
        if (result.rows[0]?.released !== true) {
          throw new PersistenceBoundaryError(
            "RUN_QUEUE_STALE_FENCE",
            "过期 Worker 不能安排 Run Work 重试。",
          );
        }
        return { released: true as const };
      },
    );
  };

  return Object.freeze({ lease, heartbeat, complete, retry });
}
