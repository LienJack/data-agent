import {
  type AgentTeamPublicTrace,
  agentTeamTraceEpochV2Schema,
  agentTeamTraceHandoffV2Schema,
  agentTeamTraceTaskV2Schema,
  agentTeamTraceTaskV3Schema,
  agentTeamTraceVerifierV2Schema,
  appScopeSchema,
  buildAgentTeamPublicTrace,
  immutableIdSchema,
  type PortResult,
  type RunRuntimeEvent,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { loadVerifiedRunEvents } from "../events/postgres-run-event-store.js";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const lookupSchema = z.strictObject({ scope: appScopeSchema, run_id: immutableIdSchema });
const projectionV2Schema = z.strictObject({
  // The RPC verifies the current persisted Task documents too. Only its public
  // Profile ID parser changes; legacy public V1/V2 DTOs remain frozen.
  tasks: z
    .array(
      agentTeamTraceTaskV2Schema.extend({
        profile_id: agentTeamTraceTaskV3Schema.shape.profile_id,
      }),
    )
    .max(1_000),
  handoffs: z.array(agentTeamTraceHandoffV2Schema).max(1_000),
  epochs: z.array(agentTeamTraceEpochV2Schema).max(10_000),
  verifier_decisions: z.array(agentTeamTraceVerifierV2Schema).max(1_000),
});

function invalid(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

function databaseError(error: unknown): PortResult<never> | null {
  const marker = error instanceof Error ? error.message : "";
  return marker === "AGENT_TEAM_TRACE_CORRUPT"
    ? invalid(marker, "Agent Team authority projection is corrupt.")
    : null;
}

export function createPostgresAgentTeamTraceProjector(options: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  return {
    async load(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<AgentTeamPublicTrace | null>> {
      const lookup = lookupSchema.safeParse(input);
      if (!lookup.success) {
        return invalid("AGENT_TEAM_TRACE_LOOKUP_INVALID", "Team trace lookup is invalid.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          snapshot: "REPEATABLE_READ",
          operation_name: "agent-team-trace.load",
          map_database_error: databaseError,
        },
        async ({ capability, client }) => {
          if (
            lookup.data.scope.app_id !== capability.scope.app_id ||
            lookup.data.scope.tenant_id !== capability.scope.tenant_id ||
            lookup.data.scope.environment !== capability.scope.environment
          ) {
            throw new PersistenceBoundaryError(
              "AGENT_TEAM_TRACE_NOT_FOUND_OR_DENIED",
              "Team run not found.",
            );
          }
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.load_agent_team_public_projection_v2($1::uuid) as value",
            [lookup.data.run_id],
          );
          if (query.rows[0]?.value == null) return null;
          const projection = projectionV2Schema.safeParse(query.rows[0].value);
          if (!projection.success) {
            throw new PersistenceBoundaryError(
              "AGENT_TEAM_TRACE_DATABASE_CONTRACT_INVALID",
              "Agent Team public projection is invalid.",
            );
          }
          const events = await loadVerifiedRunEvents(client, capability.scope, lookup.data.run_id);
          const taskById = new Map(projection.data.tasks.map((task) => [task.task_id, task]));
          const latestByTask = new Map<
            string,
            Extract<RunRuntimeEvent, { event_type: "run.agent_status" }>
          >();
          let previousSequence = 0;
          for (const event of events) {
            if (
              event.run_id !== lookup.data.run_id ||
              event.scope.app_id !== capability.scope.app_id ||
              event.scope.tenant_id !== capability.scope.tenant_id ||
              event.scope.environment !== capability.scope.environment ||
              event.sequence <= previousSequence
            ) {
              throw new PersistenceBoundaryError(
                "AGENT_TEAM_TRACE_EVENT_IDENTITY_MISMATCH",
                "Team public event identity is invalid.",
              );
            }
            previousSequence = event.sequence;
            if (event.event_type !== "run.agent_status" || event.payload.task_id === null) continue;
            const task = taskById.get(event.payload.task_id);
            if (!task) continue;
            if (
              event.payload.profile_id !== task.profile_id ||
              event.worker_fence !== task.worker_fence
            ) {
              throw new PersistenceBoundaryError(
                "AGENT_TEAM_TRACE_EVENT_IDENTITY_MISMATCH",
                "Team public event task identity is invalid.",
              );
            }
            latestByTask.set(task.task_id, event);
          }
          const tasks = await Promise.all(
            projection.data.tasks.map(async (task) => {
              const receiptStatus =
                task.acceptance?.status ?? (task.completion ? "COMPLETED" : null);
              if (task.status !== (receiptStatus ?? "RUNNING")) {
                throw new PersistenceBoundaryError(
                  "AGENT_TEAM_TRACE_DATABASE_CONTRACT_INVALID",
                  "Team receipt status is inconsistent.",
                );
              }
              const event = latestByTask.get(task.task_id);
              if (receiptStatus !== null)
                return { ...task, status: receiptStatus, status_source: { kind: "TEAM_RECEIPT" } };
              if (!event)
                return { ...task, status: "PENDING", status_source: { kind: "TASK_RECORD" } };
              return {
                ...task,
                status: event.payload.status,
                status_source: {
                  kind: "RUN_EVENT",
                  event_id: event.event_id,
                  sequence: event.sequence,
                  event_hash: await sha256ContentHash(event),
                  occurred_at: event.occurred_at,
                  status: event.payload.status,
                },
              };
            }),
          );
          return buildAgentTeamPublicTrace({
            schema_version: "agent-team-public-trace@3.0.0",
            scope: capability.scope,
            run_id: lookup.data.run_id,
            ...projection.data,
            tasks,
          });
        },
      );
    },
  };
}

export type PostgresAgentTeamTraceProjector = ReturnType<
  typeof createPostgresAgentTeamTraceProjector
>;
