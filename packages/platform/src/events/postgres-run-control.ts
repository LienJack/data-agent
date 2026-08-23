import {
  canonicalizeJson,
  contentHashSchema,
  hashRunProjection,
  type RunControlPort,
  RunProjectionError,
  type RunRuntimeEvent,
  reduceRunProjection,
  runControlCommandSchema,
  runProjectionSchema,
  runRuntimeEventSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { mapDatabaseRuntimeFailure } from "../persistence/runtime-database-errors.js";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

interface JsonResultRow {
  readonly result: unknown;
}

interface ControlStateRow {
  readonly projection_json: unknown;
  readonly projection_hash: string;
  readonly active_fence: string | number;
  readonly existing_event: unknown | null;
  readonly existing_outbox_id: string | null;
  readonly existing_audit_id: string | null;
}

const fenceSchema = z.coerce.number().int().nonnegative().safe();

function inputFailure(message: string) {
  return {
    ok: false as const,
    error: {
      code: "RUN_CONTROL_INPUT_INVALID",
      message,
      retryable: false,
    },
  };
}

export function createPostgresRunControl(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
  capabilityInput: unknown,
): RunControlPort {
  const submit: RunControlPort["submit"] = async (input) => {
    const parsed = runControlCommandSchema.safeParse(input);
    if (!parsed.success) return inputFailure("Run Control Command 不符合契约。");
    if (containsPotentialPlaintextSecret(parsed.data)) {
      return inputFailure("Run Control Command 不能包含疑似明文 Credential。");
    }

    const expectedEventType =
      parsed.data.operation === "CANCEL" ? "run.cancel_requested" : "run.resumed";

    return withAppTransaction(
      pool,
      authorizer,
      capabilityInput,
      {
        access: "WRITE",
        map_database_error: mapDatabaseRuntimeFailure,
        operation_name: "run_control.submit",
        correlation_id: parsed.data.run_id,
      },
      async ({ capability, client }) => {
        if (
          capability.scope.app_id !== parsed.data.scope.app_id ||
          capability.scope.tenant_id !== parsed.data.scope.tenant_id ||
          capability.scope.environment !== parsed.data.scope.environment
        ) {
          throw new PersistenceBoundaryError(
            "RUN_CONTROL_SCOPE_DENIED",
            "Run Control 不能替换服务端授权的 App/Tenant/Environment Scope。",
          );
        }
        const state = await client.query<ControlStateRow>(
          `select
             projection.projection_json,
             projection.projection_hash,
             run.active_fence,
             existing.event_document as existing_event,
             existing.outbox_id as existing_outbox_id,
             existing.audit_id as existing_audit_id
           from run_projections as projection
           join runs as run
             on run.app_id = projection.app_id
            and run.tenant_id = projection.tenant_id
            and run.environment = projection.environment
            and run.run_id = projection.run_id
           left join lateral (
             select
               event.event_document,
               (
                 select message.outbox_id
                 from outbox as message
                 where message.app_id = event.app_id
                   and message.tenant_id = event.tenant_id
                   and message.environment = event.environment
                   and message.run_id = event.run_id
                   and message.command_id = event.command_id
                 order by message.queue_sequence desc
                 limit 1
               ) as outbox_id,
               (
                 select audit.audit_id
                 from audit_log as audit
                 where audit.app_id = event.app_id
                   and audit.tenant_id = event.tenant_id
                   and audit.environment = event.environment
                   and audit.resource_type = 'run'
                   and audit.resource_id = event.run_id::text
                   and audit.details ->> 'commandId' = event.command_id::text
                 order by audit.created_at desc, audit.audit_id desc
                 limit 1
               ) as audit_id
             from run_events as event
             where event.app_id = projection.app_id
               and event.tenant_id = projection.tenant_id
               and event.environment = projection.environment
               and event.run_id = projection.run_id
               and (event.event_id = $5 or event.dedupe_key = $6)
             order by event.sequence desc
             limit 1
           ) as existing on true
           where projection.app_id = $1
             and projection.tenant_id = $2
             and projection.environment = $3
             and projection.run_id = $4
           order by projection.version desc
           limit 1`,
          [
            capability.scope.app_id,
            capability.scope.tenant_id,
            capability.scope.environment,
            parsed.data.run_id,
            parsed.data.event_id,
            parsed.data.idempotency_key,
          ],
        );
        const stateRow = state.rows[0];
        if (!stateRow) {
          throw new PersistenceBoundaryError(
            "RUN_CONTROL_RUN_NOT_FOUND",
            "Run 不存在或没有可重放的 Durable Event。",
          );
        }
        const currentProjection = runProjectionSchema.parse(stateRow.projection_json);
        const currentProjectionHash = contentHashSchema.parse(stateRow.projection_hash);
        const activeFence = fenceSchema.parse(stateRow.active_fence);
        if (
          currentProjection.run_id !== parsed.data.run_id ||
          currentProjection.scope.app_id !== capability.scope.app_id ||
          currentProjection.scope.tenant_id !== capability.scope.tenant_id ||
          currentProjection.scope.environment !== capability.scope.environment ||
          (await hashRunProjection(currentProjection)) !== currentProjectionHash
        ) {
          throw new PersistenceBoundaryError(
            "RUN_CONTROL_PROJECTION_CORRUPT",
            "Stored Run Projection 与请求 Scope/Hash 不一致。",
          );
        }
        if (stateRow.existing_event !== null) {
          const existing = runRuntimeEventSchema.parse(stateRow.existing_event);
          if (
            existing.event_type !== expectedEventType ||
            existing.payload.command_id !== parsed.data.command_id ||
            existing.event_id !== parsed.data.event_id ||
            existing.idempotency_key !== parsed.data.idempotency_key ||
            existing.occurred_at !== parsed.data.occurred_at ||
            existing.run_id !== parsed.data.run_id ||
            existing.scope.app_id !== parsed.data.scope.app_id ||
            existing.scope.tenant_id !== parsed.data.scope.tenant_id ||
            existing.scope.environment !== parsed.data.scope.environment ||
            stateRow.existing_outbox_id !== parsed.data.outbox_id ||
            stateRow.existing_audit_id !== parsed.data.audit_id
          ) {
            throw new PersistenceBoundaryError(
              "RUN_CONTROL_IDEMPOTENCY_CONFLICT",
              "Run Control Idempotency Key 或 Event ID 已绑定其他控制命令。",
            );
          }
          return {
            replayed: true,
            command_id: parsed.data.command_id,
            projection: currentProjection,
            projection_hash: currentProjectionHash,
          };
        }

        const event = runRuntimeEventSchema.parse({
          schema_version: "1.0.0",
          event_id: parsed.data.event_id,
          scope: parsed.data.scope,
          run_id: parsed.data.run_id,
          sequence: currentProjection.version + 1,
          worker_fence:
            parsed.data.operation === "CANCEL" ? activeFence + 1 : currentProjection.worker_fence,
          idempotency_key: parsed.data.idempotency_key,
          occurred_at: parsed.data.occurred_at,
          event_type: expectedEventType,
          payload: { command_id: parsed.data.command_id },
        }) satisfies RunRuntimeEvent;
        let nextProjection: ReturnType<typeof reduceRunProjection>;
        try {
          nextProjection = reduceRunProjection(currentProjection, event);
        } catch (error) {
          if (error instanceof RunProjectionError) {
            throw new PersistenceBoundaryError(
              "RUN_CONTROL_STATE_INVALID",
              "Run 当前状态或 Fence 不允许执行该控制命令。",
            );
          }
          throw error;
        }
        const [eventHash, nextProjectionHash] = await Promise.all([
          sha256ContentHash(event),
          hashRunProjection(nextProjection),
        ]);
        const result = await client.query<JsonResultRow>(
          `select app_data_agent.request_run_control(
             $1::jsonb, $2::jsonb, $3::text, $4::text, $5::jsonb, $6::text
           ) as result`,
          [
            JSON.stringify(parsed.data),
            JSON.stringify(event),
            eventHash,
            currentProjectionHash,
            JSON.stringify(nextProjection),
            nextProjectionHash,
          ],
        );
        const resultSchema = z.strictObject({
          replayed: z.boolean(),
          command_id: z.uuid(),
          event_id: z.uuid(),
          event_hash: contentHashSchema,
          outbox_id: z.uuid(),
          audit_id: z.uuid(),
          projection: runProjectionSchema,
          projection_hash: contentHashSchema,
        });
        const committedResult = resultSchema.safeParse(result.rows[0]?.result);
        if (!committedResult.success) {
          throw new PersistenceBoundaryError(
            "RUN_CONTROL_DATABASE_CONTRACT_INVALID",
            "PostgreSQL 返回的 Run Control Receipt 不满足权威契约。",
          );
        }
        const committed = committedResult.data;
        const committedProjectionHash = await hashRunProjection(committed.projection);
        if (
          committed.command_id !== parsed.data.command_id ||
          committed.event_id !== parsed.data.event_id ||
          committed.event_hash !== eventHash ||
          committed.outbox_id !== parsed.data.outbox_id ||
          committed.audit_id !== parsed.data.audit_id ||
          committed.projection.scope.app_id !== parsed.data.scope.app_id ||
          committed.projection.scope.tenant_id !== parsed.data.scope.tenant_id ||
          committed.projection.scope.environment !== parsed.data.scope.environment ||
          committed.projection.run_id !== parsed.data.run_id ||
          committedProjectionHash !== committed.projection_hash ||
          (!committed.replayed &&
            (canonicalizeJson(committed.projection) !== canonicalizeJson(nextProjection) ||
              committed.projection_hash !== nextProjectionHash))
        ) {
          throw new PersistenceBoundaryError(
            "RUN_CONTROL_DATABASE_CONTRACT_INVALID",
            "PostgreSQL 返回了不匹配的 Run Control Command/Projection。",
          );
        }
        return {
          replayed: committed.replayed,
          command_id: committed.command_id,
          projection: committed.projection,
          projection_hash: committed.projection_hash,
        };
      },
    );
  };

  return Object.freeze({ submit });
}
