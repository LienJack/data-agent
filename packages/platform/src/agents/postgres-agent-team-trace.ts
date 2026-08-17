import {
  type AgentTeamPublicTrace,
  agentTeamTraceEpochSchema,
  agentTeamTraceHandoffSchema,
  agentTeamTraceTaskSchema,
  agentTeamTraceVerifierSchema,
  appScopeSchema,
  buildAgentTeamPublicTrace,
  immutableIdSchema,
  type PortResult,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const lookupSchema = z.strictObject({ scope: appScopeSchema, run_id: immutableIdSchema });
const projectionSchema = z.strictObject({
  tasks: z.array(agentTeamTraceTaskSchema).max(1_000),
  handoffs: z.array(agentTeamTraceHandoffSchema).max(1_000),
  epochs: z.array(agentTeamTraceEpochSchema).max(10_000),
  verifier_decisions: z.array(agentTeamTraceVerifierSchema).max(1_000),
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
            "select app_data_agent.load_agent_team_public_projection($1::uuid) as value",
            [lookup.data.run_id],
          );
          if (query.rows[0]?.value == null) return null;
          const projection = projectionSchema.safeParse(query.rows[0].value);
          if (!projection.success) {
            throw new PersistenceBoundaryError(
              "AGENT_TEAM_TRACE_DATABASE_CONTRACT_INVALID",
              "Agent Team public projection is invalid.",
            );
          }
          return buildAgentTeamPublicTrace({
            schema_version: "agent-team-public-trace@1.0.0",
            scope: capability.scope,
            run_id: lookup.data.run_id,
            ...projection.data,
          });
        },
      );
    },
  };
}

export type PostgresAgentTeamTraceProjector = ReturnType<
  typeof createPostgresAgentTeamTraceProjector
>;
