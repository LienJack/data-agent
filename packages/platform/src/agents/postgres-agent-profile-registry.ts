import {
  type AgentProductProfileCommitCommand,
  type AgentProductProfileRegistryItem,
  agentProductProfileCommitResultSchema,
  agentProductProfileListResultSchema,
  type PortResult,
  verifyAgentProductProfileCommitCommand,
  verifyAgentProductProfileRevision,
} from "@data-agent/contracts";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

function databaseError(error: unknown): PortResult<never> | null {
  const marker = error instanceof Error ? error.message : "";
  if (!/^AGENT_PROFILE_[A-Z0-9_]+$/.test(marker)) return null;
  return {
    ok: false,
    error: {
      code: marker,
      message: "Agent Profile Registry rejected the operation.",
      retryable: marker.endsWith("VERSION_CONFLICT"),
    },
  };
}

function invalid(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

export interface PostgresAgentProfileRegistryOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

export function createPostgresAgentProfileRegistry(options: PostgresAgentProfileRegistryOptions) {
  return Object.freeze({
    async commit(
      capabilityInput: unknown,
      commandInput: unknown,
    ): Promise<PortResult<AgentProductProfileRegistryItem>> {
      let command: AgentProductProfileCommitCommand;
      try {
        command = await verifyAgentProductProfileCommitCommand(commandInput);
        await verifyAgentProductProfileRevision(command.revision);
      } catch {
        return invalid("AGENT_PROFILE_COMMAND_INVALID", "Agent Profile command is invalid.");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "agent-profile.commit",
          correlation_id: command.operation_id,
          map_database_error: databaseError,
        },
        async ({ capability, client }) => {
          if (
            command.actor_principal_id !== capability.principal ||
            command.revision.scope.app_id !== capability.scope.app_id ||
            command.revision.scope.tenant_id !== capability.scope.tenant_id ||
            command.revision.scope.environment !== capability.scope.environment
          ) {
            throw new PersistenceBoundaryError(
              "AGENT_PROFILE_SCOPE_DENIED",
              "Agent Profile command does not match current authority.",
            );
          }
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.commit_agent_profile_revision($1::jsonb) as value",
            [command],
          );
          const result = agentProductProfileCommitResultSchema.safeParse(query.rows[0]?.value);
          if (
            !result.success ||
            result.data.operation_id !== command.operation_id ||
            result.data.command_hash !== command.command_hash ||
            result.data.item.revision.revision_hash !== command.revision.revision_hash
          ) {
            throw new PersistenceBoundaryError(
              "AGENT_PROFILE_DATABASE_CONTRACT_INVALID",
              "Agent Profile result identity was substituted.",
            );
          }
          await verifyAgentProductProfileRevision(result.data.item.revision);
          return result.data.item;
        },
      );
    },

    list(
      capabilityInput: unknown,
      enabledOnly = false,
    ): Promise<PortResult<readonly AgentProductProfileRegistryItem[]>> {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "agent-profile.list",
          correlation_id: "agent-profile-list",
          map_database_error: databaseError,
        },
        async ({ capability, client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.list_agent_profile_revisions($1::boolean) as value",
            [enabledOnly],
          );
          const result = agentProductProfileListResultSchema.safeParse(query.rows[0]?.value);
          if (!result.success) {
            throw new PersistenceBoundaryError(
              "AGENT_PROFILE_DATABASE_CONTRACT_INVALID",
              "Agent Profile list is invalid.",
            );
          }
          for (const item of result.data.items) {
            await verifyAgentProductProfileRevision(item.revision);
            if (
              item.revision.scope.app_id !== capability.scope.app_id ||
              item.revision.scope.tenant_id !== capability.scope.tenant_id ||
              item.revision.scope.environment !== capability.scope.environment ||
              (enabledOnly &&
                (item.head.lifecycle !== "ENABLED" || item.revision.approval_status !== "APPROVED"))
            ) {
              throw new PersistenceBoundaryError(
                "AGENT_PROFILE_DATABASE_CONTRACT_INVALID",
                "Agent Profile list escaped current scope.",
              );
            }
          }
          return result.data.items;
        },
      );
    },
  });
}

export type PostgresAgentProfileRegistry = ReturnType<typeof createPostgresAgentProfileRegistry>;
