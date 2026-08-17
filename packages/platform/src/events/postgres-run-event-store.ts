import {
  type AppScope,
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  eventIdempotencyKeySchema,
  hashRunProjection,
  type MastraSnapshotBinding,
  mastraSnapshotBindingBodySchema,
  mastraSnapshotBindingSchema,
  type PortResult,
  type RunEventStorePort,
  RunProjectionError,
  type RunProjectionRecord,
  type RunRuntimeEvent,
  reduceRunProjection,
  runProjectionRecordSchema,
  runProjectionSchema,
  runRuntimeEventSchema,
  runWorkLeaseSchema,
  type SideEffectReceipt,
  sha256ContentHash,
  sideEffectReceiptSchema,
  workerRunRuntimeEventSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { mapDatabaseRuntimeFailure } from "../persistence/runtime-database-errors.js";
import {
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const runLookupSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: z.uuid(),
});
const runEventLookupSchema = runLookupSchema.extend({
  after_sequence: z.number().int().nonnegative().safe().optional(),
  limit: z.number().int().positive().max(500).safe().default(256),
});
const runEventIdentityLookupSchema = runLookupSchema.extend({
  idempotency_key: eventIdempotencyKeySchema,
});
const sideEffectLookupSchema = runLookupSchema.extend({
  effect_kind: z.enum(["SQL", "EVAL"]),
  input_hash: contentHashSchema,
});

interface RunEventRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly event_id: string;
  readonly run_id: string;
  readonly sequence: string | number;
  readonly event_type: string;
  readonly payload_json: unknown;
  readonly worker_fence: string | number;
  readonly dedupe_key: string | null;
  readonly event_hash: string;
  readonly event_document: unknown;
  readonly created_at: Date | string;
}

interface ProjectionRow {
  readonly projection_json: unknown;
  readonly projection_hash: string;
}

interface JsonResultRow {
  readonly result: unknown;
}

interface SnapshotRow {
  readonly active_snapshot_ref: unknown;
  readonly snapshot_json: unknown;
  readonly stored_snapshot_hash: string | null;
  readonly recomputed_snapshot_hash: string | null;
}

interface ReceiptRow {
  readonly receipt_json: unknown;
}

function invalidInput<T>(message: string): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "RUN_EVENT_STORE_INPUT_INVALID",
      message,
      retryable: false,
    },
  };
}

function projectionBoundaryError(error: RunProjectionError): PersistenceBoundaryError {
  switch (error.code) {
    case "RUN_EVENT_SEQUENCE_INVALID":
      return new PersistenceBoundaryError(
        "RUN_PROJECTION_CONFLICT",
        "Run Event Sequence 已变化，调用方必须重放后再提交。",
        true,
      );
    case "RUN_EVENT_FENCE_INVALID":
      return new PersistenceBoundaryError(
        "RUN_COMMIT_CANCELLED_OR_STALE",
        "Run 已取消、进入终态或 Worker Fence 已过期，拒绝迟到提交。",
      );
    case "RUN_EVENT_AFTER_TERMINAL":
      return new PersistenceBoundaryError(
        "RUN_COMMIT_CANCELLED_OR_STALE",
        "Run 已进入终态，拒绝迟到提交。",
      );
    case "RUN_EVENT_TRANSITION_INVALID":
      return new PersistenceBoundaryError(
        "RUN_RUNTIME_INVARIANT_VIOLATION",
        "Run Event 不满足数据库权威状态机。",
      );
    case "RUN_EVENT_SCOPE_MISMATCH":
      return new PersistenceBoundaryError(
        "RUN_EVENT_STORE_INPUT_INVALID",
        "Run Event 与 Expected Projection 不属于同一 Scope 或 Run。",
      );
  }
}

function reduceAppendProjection(
  current: RunProjectionRecord["projection"],
  event: RunRuntimeEvent,
): RunProjectionRecord["projection"] {
  try {
    return reduceRunProjection(current, event);
  } catch (error) {
    if (error instanceof RunProjectionError) {
      throw projectionBoundaryError(error);
    }
    throw error;
  }
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
      "RUN_EVENT_STORE_SCOPE_DENIED",
      "Run Event Store 请求不能替换服务端授权的 App/Tenant/Environment Scope。",
    );
  }
}

function assertLeasePrincipal(requested: string, authorized: string): void {
  if (requested !== authorized) {
    throw new PersistenceBoundaryError(
      "RUN_EVENT_STORE_PRINCIPAL_DENIED",
      "Run Work Lease 的 Principal 与当前服务端 Authority 不一致。",
    );
  }
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new PersistenceBoundaryError(
      "RUN_EVENT_STORE_EVENT_CORRUPT",
      "Stored Run Event Timestamp 无效。",
    );
  }
  return parsed.toISOString();
}

function parseStoredEnvelope<T>(
  schema: z.ZodType<T>,
  input: unknown,
  code: string,
  message: string,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(code, message);
  }
  return parsed.data;
}

function eventFromRow(row: RunEventRow): RunRuntimeEvent {
  const event = parseStoredEnvelope(
    runRuntimeEventSchema,
    row.event_document,
    "RUN_EVENT_STORE_EVENT_CORRUPT",
    "Stored Run Event Document 不符合权威契约。",
  );
  const relationalProjection = parseStoredEnvelope(
    runRuntimeEventSchema,
    {
      schema_version: "1.0.0",
      event_id: row.event_id,
      scope: {
        app_id: row.app_id,
        tenant_id: row.tenant_id,
        environment: row.environment,
      },
      run_id: row.run_id,
      sequence: Number(row.sequence),
      worker_fence: Number(row.worker_fence),
      idempotency_key: row.dedupe_key ?? `event:${row.event_id}`,
      occurred_at: iso(row.created_at),
      event_type: row.event_type,
      payload: row.payload_json,
    },
    "RUN_EVENT_STORE_EVENT_CORRUPT",
    "Stored Run Event 关系列不符合权威契约。",
  );
  if (canonicalizeJson(event) !== canonicalizeJson(relationalProjection)) {
    throw new PersistenceBoundaryError(
      "RUN_EVENT_STORE_EVENT_CORRUPT",
      "Stored Run Event Document 与关系列不一致。",
    );
  }
  return event;
}

async function verifiedEventFromRow(row: RunEventRow): Promise<RunRuntimeEvent> {
  const event = eventFromRow(row);
  const storedHash = contentHashSchema.safeParse(row.event_hash);
  if (!storedHash.success || storedHash.data !== (await sha256ContentHash(event))) {
    throw new PersistenceBoundaryError(
      "RUN_EVENT_STORE_EVENT_CORRUPT",
      "Stored Run Event Hash 与规范化 Event 不匹配。",
    );
  }
  return event;
}

export async function loadVerifiedRunEvents(
  client: SqlClient,
  scope: AppScope,
  runId: string,
  afterSequence = 0,
  limit?: number,
): Promise<RunRuntimeEvent[]> {
  const result = await client.query<RunEventRow>(
    `select
       app_id,
       tenant_id,
       environment,
       event_id,
       run_id,
       sequence,
       event_type,
       payload_json,
       worker_fence,
       dedupe_key,
       event_hash,
       event_document,
       created_at
     from run_events
     where app_id = $1
       and tenant_id = $2
       and environment = $3
       and run_id = $4
       and sequence > $5
     order by sequence
     limit $6`,
    [scope.app_id, scope.tenant_id, scope.environment, runId, afterSequence, limit ?? null],
  );
  const events: RunRuntimeEvent[] = [];
  for (const row of result.rows) {
    events.push(await verifiedEventFromRow(row));
  }
  return events;
}

async function projectionRecordFromRow(row: ProjectionRow): Promise<RunProjectionRecord> {
  const replaySafeProjection = parseStoredEnvelope(
    runProjectionSchema,
    row.projection_json,
    "RUN_EVENT_STORE_PROJECTION_CORRUPT",
    "Stored Run Projection 不符合权威契约。",
  );
  const storedHash = parseStoredEnvelope(
    contentHashSchema,
    row.projection_hash,
    "RUN_EVENT_STORE_PROJECTION_CORRUPT",
    "Stored Run Projection Hash 不符合权威契约。",
  );
  const computedHash = await hashRunProjection(replaySafeProjection);
  if (computedHash !== storedHash) {
    throw new PersistenceBoundaryError(
      "RUN_EVENT_STORE_PROJECTION_CORRUPT",
      "Stored Run Projection Hash 与规范化 Projection 不匹配。",
    );
  }
  return { projection: replaySafeProjection, projection_hash: storedHash };
}

async function loadProjection(
  client: SqlClient,
  scope: AppScope,
  runId: string,
): Promise<RunProjectionRecord | null> {
  const stored = await client.query<ProjectionRow>(
    `select projection_json, projection_hash
     from run_projections
     where app_id = $1
       and tenant_id = $2
       and environment = $3
       and run_id = $4
     order by version desc
     limit 1`,
    [scope.app_id, scope.tenant_id, scope.environment, runId],
  );
  const row = stored.rows[0];
  if (row) return projectionRecordFromRow(row);

  const eventPresence = await client.query<{ readonly exists: boolean }>(
    `select exists (
       select 1
       from run_events
       where app_id = $1
         and tenant_id = $2
         and environment = $3
         and run_id = $4
       limit 1
     ) as exists`,
    [scope.app_id, scope.tenant_id, scope.environment, runId],
  );
  if (eventPresence.rows[0]?.exists === true) {
    throw new PersistenceBoundaryError(
      "RUN_EVENT_STORE_PROJECTION_CORRUPT",
      "Run Event 已存在但权威 Projection 缺失。",
    );
  }
  return null;
}

export function createPostgresRunEventStore(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
  capabilityInput: unknown,
): RunEventStorePort {
  const readProjection: RunEventStorePort["readProjection"] = async (input) => {
    const parsed = runLookupSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Run Projection Lookup 输入不符合契约。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "READ", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        return loadProjection(client, capability.scope, parsed.data.run_id);
      },
    );
  };

  const listEvents: RunEventStorePort["listEvents"] = async (input) => {
    const parsed = runEventLookupSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Run Event Lookup 输入不符合契约。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "READ", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        return loadVerifiedRunEvents(
          client,
          capability.scope,
          parsed.data.run_id,
          parsed.data.after_sequence,
          parsed.data.limit,
        );
      },
    );
  };

  const findEventByIdempotencyKey: RunEventStorePort["findEventByIdempotencyKey"] = async (
    input,
  ) => {
    const parsed = runEventIdentityLookupSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Run Event Identity Lookup 输入不符合契约。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "READ", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        const result = await client.query<RunEventRow>(
          `select
             app_id,
             tenant_id,
             environment,
             event_id,
             run_id,
             sequence,
             event_type,
             payload_json,
             worker_fence,
             dedupe_key,
             event_hash,
             event_document,
             created_at
           from run_events
           where app_id = $1
             and tenant_id = $2
             and environment = $3
             and run_id = $4
             and dedupe_key = $5
           limit 1`,
          [
            capability.scope.app_id,
            capability.scope.tenant_id,
            capability.scope.environment,
            parsed.data.run_id,
            parsed.data.idempotency_key,
          ],
        );
        const row = result.rows[0];
        return row ? verifiedEventFromRow(row) : null;
      },
    );
  };

  const append: RunEventStorePort["append"] = async (input) => {
    const parsedLease = runWorkLeaseSchema.safeParse(input.lease);
    const parsedEvent = workerRunRuntimeEventSchema.safeParse(input.event);
    const parsedExpectedProjection = runProjectionRecordSchema.safeParse(input.expected_projection);
    if (!parsedLease.success || !parsedEvent.success || !parsedExpectedProjection.success) {
      return invalidInput("Run Event Append 输入不符合契约。");
    }
    if (
      !scopeMatches(parsedLease.data.scope, parsedEvent.data.scope) ||
      parsedLease.data.run_id !== parsedEvent.data.run_id ||
      parsedLease.data.worker_fence !== parsedEvent.data.worker_fence
    ) {
      return invalidInput("Run Event 与当前 Work Lease 的 Scope、Run 或 Fence 不一致。");
    }
    if (
      (await hashRunProjection(parsedExpectedProjection.data.projection)) !==
        parsedExpectedProjection.data.projection_hash ||
      !scopeMatches(parsedExpectedProjection.data.projection.scope, parsedEvent.data.scope) ||
      parsedExpectedProjection.data.projection.run_id !== parsedEvent.data.run_id
    ) {
      return invalidInput("Expected Run Projection 与 Event 的 Scope、Run 或 Hash 不一致。");
    }
    if (containsPotentialPlaintextSecret(parsedEvent.data)) {
      return invalidInput("Run Event 不能持久化疑似明文 Credential。");
    }
    const eventHash = await sha256ContentHash(parsedEvent.data);

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "WRITE", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsedEvent.data.scope, capability.scope);
        assertLeasePrincipal(parsedLease.data.principal_id, capability.principal);
        const current = parsedExpectedProjection.data;
        const nextProjection = reduceAppendProjection(current.projection, parsedEvent.data);
        const nextProjectionHash = await hashRunProjection(nextProjection);
        const result = await client.query<JsonResultRow>(
          `select app_data_agent.append_run_event(
             $1::jsonb, $2::jsonb, $3::text, $4::text, $5::jsonb, $6::text
           ) as result`,
          [
            JSON.stringify(parsedLease.data),
            JSON.stringify(parsedEvent.data),
            eventHash,
            current.projection_hash,
            JSON.stringify(nextProjection),
            nextProjectionHash,
          ],
        );
        const committed = parseStoredEnvelope(
          z.strictObject({
            replayed: z.boolean(),
            event: runRuntimeEventSchema,
            event_hash: contentHashSchema,
            projection: runProjectionSchema,
            projection_hash: contentHashSchema,
          }),
          result.rows[0]?.result,
          "RUN_EVENT_STORE_DATABASE_CONTRACT_INVALID",
          "PostgreSQL 返回的 Event/Projection 不符合权威契约。",
        );
        const [committedEventHash, committedProjectionHash] = await Promise.all([
          sha256ContentHash(committed.event),
          hashRunProjection(committed.projection),
        ]);
        if (
          canonicalizeJson(committed.event) !== canonicalizeJson(parsedEvent.data) ||
          committed.event_hash !== eventHash ||
          committedEventHash !== committed.event_hash ||
          committedProjectionHash !== committed.projection_hash ||
          !scopeMatches(committed.projection.scope, parsedEvent.data.scope) ||
          committed.projection.run_id !== parsedEvent.data.run_id ||
          (!committed.replayed &&
            (canonicalizeJson(committed.projection) !== canonicalizeJson(nextProjection) ||
              committed.projection_hash !== nextProjectionHash))
        ) {
          throw new PersistenceBoundaryError(
            "RUN_EVENT_STORE_DATABASE_CONTRACT_INVALID",
            "PostgreSQL 返回的 Event/Projection 与规范提交不一致。",
          );
        }
        return {
          replayed: committed.replayed,
          event: committed.event,
          projection: committed.projection,
          projection_hash: committed.projection_hash,
        };
      },
    );
  };

  const commitSnapshot: RunEventStorePort["commitSnapshot"] = async (input) => {
    const parsedLease = runWorkLeaseSchema.safeParse(input.lease);
    const parsed = mastraSnapshotBindingBodySchema.safeParse(input.binding);
    if (!parsedLease.success) {
      return invalidInput("Mastra Snapshot Work Lease 不符合契约。");
    }
    if (!parsed.success) {
      return invalidInput("Mastra Snapshot Binding Body 不符合契约。");
    }
    if (
      !scopeMatches(parsedLease.data.scope, parsed.data.scope) ||
      parsedLease.data.run_id !== parsed.data.run_id ||
      parsedLease.data.attempt_id !== parsed.data.attempt_id ||
      parsedLease.data.worker_fence !== parsed.data.worker_fence
    ) {
      return invalidInput("Mastra Snapshot Binding 与当前 Work Lease 不一致。");
    }
    if (containsPotentialPlaintextSecret(parsed.data)) {
      return invalidInput("Mastra Snapshot 不能持久化疑似明文 Credential。");
    }

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "WRITE", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        assertLeasePrincipal(parsedLease.data.principal_id, capability.principal);
        const result = await client.query<JsonResultRow>(
          "select app_data_agent.commit_run_checkpoint($1::jsonb, $2::jsonb) as result",
          [JSON.stringify(parsedLease.data), JSON.stringify(parsed.data)],
        );
        const committed = parseStoredEnvelope(
          z.strictObject({
            created: z.boolean(),
            binding: mastraSnapshotBindingSchema,
          }),
          result.rows[0]?.result,
          "RUN_CHECKPOINT_CONFLICT",
          "PostgreSQL 返回的 Mastra Snapshot Binding 不符合权威契约。",
        );
        const { snapshot_hash: _authoritativeHash, ...committedBody } = committed.binding;
        if (canonicalizeJson(committedBody) !== canonicalizeJson(parsed.data)) {
          throw new PersistenceBoundaryError(
            "RUN_CHECKPOINT_CONFLICT",
            "PostgreSQL 返回的 Mastra Snapshot Binding Body 与提交内容不一致。",
          );
        }
        return {
          created: committed.created,
          binding: committed.binding,
        };
      },
    );
  };

  const loadLatestSnapshot: RunEventStorePort["loadLatestSnapshot"] = async (input) => {
    const parsed = runLookupSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Mastra Snapshot Lookup 输入不符合契约。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "READ", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        const result = await client.query<SnapshotRow>(
          `select
             projection.projection_json -> 'active_snapshot_ref' as active_snapshot_ref,
             checkpoint.binding_json as snapshot_json,
             checkpoint.snapshot_hash as stored_snapshot_hash,
             app_data_agent.runtime_canonical_sha256(
               checkpoint.binding_json - 'snapshot_hash'
             ) as recomputed_snapshot_hash
           from (
             select candidate.projection_json
             from run_projections as candidate
             where candidate.app_id = $1
               and candidate.tenant_id = $2
               and candidate.environment = $3
               and candidate.run_id = $4
             order by candidate.version desc
             limit 1
           ) as projection
           left join run_checkpoints as checkpoint
             on checkpoint.app_id = $1
            and checkpoint.tenant_id = $2
            and checkpoint.environment = $3
            and checkpoint.run_id = $4
            and checkpoint.snapshot_id =
              (projection.projection_json -> 'active_snapshot_ref' ->> 'snapshot_id')::uuid
            and checkpoint.snapshot_version =
              (projection.projection_json -> 'active_snapshot_ref' ->> 'snapshot_version')::integer
            and checkpoint.snapshot_hash =
              projection.projection_json -> 'active_snapshot_ref' ->> 'snapshot_hash'
           limit 1`,
          [
            capability.scope.app_id,
            capability.scope.tenant_id,
            capability.scope.environment,
            parsed.data.run_id,
          ],
        );
        const row = result.rows[0];
        if (!row || row.active_snapshot_ref === null) return null;
        if (row.snapshot_json === null || row.snapshot_json === undefined) {
          throw new PersistenceBoundaryError(
            "RUN_EVENT_STORE_SNAPSHOT_CORRUPT",
            "Run Projection 引用的 Mastra Snapshot 不存在。",
          );
        }
        const binding = parseStoredEnvelope(
          mastraSnapshotBindingSchema,
          row.snapshot_json,
          "RUN_EVENT_STORE_SNAPSHOT_CORRUPT",
          "Stored Mastra Snapshot 不符合权威契约。",
        );
        if (
          !scopeMatches(binding.scope, capability.scope) ||
          binding.run_id !== parsed.data.run_id
        ) {
          throw new PersistenceBoundaryError(
            "RUN_EVENT_STORE_SNAPSHOT_CORRUPT",
            "Stored Mastra Snapshot 不属于请求的 App/Tenant/Environment/Run。",
          );
        }
        if (
          row.stored_snapshot_hash !== binding.snapshot_hash ||
          row.recomputed_snapshot_hash !== binding.snapshot_hash
        ) {
          throw new PersistenceBoundaryError(
            "RUN_EVENT_STORE_SNAPSHOT_CORRUPT",
            "Stored Mastra Snapshot Hash 未通过 PostgreSQL 权威重算。",
          );
        }
        return binding;
      },
    );
  };

  const findSideEffect: RunEventStorePort["findSideEffect"] = async (input) => {
    const parsed = sideEffectLookupSchema.safeParse(input);
    if (!parsed.success) return invalidInput("Side Effect Lookup 输入不符合契约。");

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "READ", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        const result = await client.query<ReceiptRow>(
          `select receipt_json
           from run_effect_receipts
           where app_id = $1
             and tenant_id = $2
             and environment = $3
             and run_id = $4
             and effect_kind = $5
             and input_hash = $6`,
          [
            capability.scope.app_id,
            capability.scope.tenant_id,
            capability.scope.environment,
            parsed.data.run_id,
            parsed.data.effect_kind,
            parsed.data.input_hash,
          ],
        );
        const row = result.rows[0];
        if (!row) return null;
        const receipt = parseStoredEnvelope(
          sideEffectReceiptSchema,
          row.receipt_json,
          "RUN_EVENT_STORE_RECEIPT_CORRUPT",
          "Stored Side Effect Receipt 不符合权威契约。",
        );
        if (
          !scopeMatches(receipt.scope, capability.scope) ||
          receipt.run_id !== parsed.data.run_id
        ) {
          throw new PersistenceBoundaryError(
            "RUN_EVENT_STORE_RECEIPT_CORRUPT",
            "Stored Side Effect Receipt 不属于请求的 App/Tenant/Environment/Run。",
          );
        }
        return receipt;
      },
    );
  };

  const commitSideEffect: RunEventStorePort["commitSideEffect"] = async (input) => {
    const parsedLease = runWorkLeaseSchema.safeParse(input.lease);
    const parsed = sideEffectReceiptSchema.safeParse(input.receipt);
    if (!parsedLease.success || !parsed.success) {
      return invalidInput("Side Effect Receipt 或 Work Lease 不符合契约。");
    }
    if (
      !scopeMatches(parsedLease.data.scope, parsed.data.scope) ||
      parsedLease.data.run_id !== parsed.data.run_id ||
      parsedLease.data.worker_fence !== parsed.data.worker_fence
    ) {
      return invalidInput("Side Effect Receipt 与当前 Work Lease 不一致。");
    }
    if (containsPotentialPlaintextSecret(parsed.data)) {
      return invalidInput("Side Effect Receipt 不能持久化疑似明文 Credential。");
    }

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      { access: "WRITE", map_database_error: mapDatabaseRuntimeFailure },
      async ({ capability, client }) => {
        assertScope(parsed.data.scope, capability.scope);
        assertLeasePrincipal(parsedLease.data.principal_id, capability.principal);
        const result = await client.query<JsonResultRow>(
          "select app_data_agent.commit_run_effect_receipt($1::jsonb, $2::jsonb) as result",
          [JSON.stringify(parsedLease.data), JSON.stringify(parsed.data)],
        );
        const resultSchema = z.strictObject({
          created: z.boolean(),
          receipt: sideEffectReceiptSchema,
        });
        const committed = parseStoredEnvelope(
          resultSchema,
          result.rows[0]?.result,
          "RUN_EFFECT_RECEIPT_CONFLICT",
          "PostgreSQL 返回的 Side Effect Receipt 不符合权威契约。",
        );
        if (
          !scopeMatches(committed.receipt.scope, parsed.data.scope) ||
          committed.receipt.run_id !== parsed.data.run_id ||
          committed.receipt.effect_kind !== parsed.data.effect_kind ||
          committed.receipt.input_hash !== parsed.data.input_hash ||
          committed.receipt.output_hash !== parsed.data.output_hash ||
          canonicalizeJson(committed.receipt.artifact_ref ?? null) !==
            canonicalizeJson(parsed.data.artifact_ref ?? null)
        ) {
          throw new PersistenceBoundaryError(
            "RUN_EFFECT_RECEIPT_CONFLICT",
            "Content-Addressed Side Effect Receipt 已绑定不同输出。",
          );
        }
        return committed;
      },
    );
  };

  return Object.freeze({
    readProjection,
    append,
    listEvents,
    findEventByIdempotencyKey,
    commitSnapshot,
    loadLatestSnapshot,
    findSideEffect,
    commitSideEffect,
  });
}

export type { MastraSnapshotBinding, SideEffectReceipt };
