import {
  type CreateSemanticPublisherGrantCommand,
  type CreateSemanticPublisherGrantResult,
  createSemanticPublisherGrantCommandSchema,
  createSemanticPublisherGrantResultSchema,
  type PortResult,
  sha256ContentHash,
} from "@data-agent/contracts";
import { createPostgresTeamRunStore } from "../agents/postgres-team-run-store.js";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

interface JsonValueRow {
  readonly value: unknown;
}

export interface PostgresPrivilegedGrantAuthority {
  createPublisherGrant(
    capability: unknown,
    command: unknown,
  ): Promise<PortResult<CreateSemanticPublisherGrantResult>>;
  issueTaskCapability(capability: unknown, command: unknown): Promise<PortResult<unknown>>;
}

export interface PostgresPrivilegedGrantAuthorityOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

function invalid(message: string): PortResult<never> {
  return {
    ok: false,
    error: { code: "SEMANTIC_PUBLISHER_GRANT_INVALID", message, retryable: false },
  };
}

function mapDatabaseError(error: unknown): PortResult<never> | null {
  const message = error instanceof Error ? error.message : "";
  for (const marker of [
    "SEMANTIC_PUBLISHER_GRANT_COMMAND_INVALID",
    "SEMANTIC_PUBLISHER_GRANT_IDEMPOTENCY_CONFLICT",
    "SEMANTIC_PUBLISHER_GRANT_KEY_NOT_ACTIVE",
    "SEMANTIC_PUBLISHER_GRANT_POLICY_STALE",
  ]) {
    if (message.includes(marker)) {
      return {
        ok: false,
        error: {
          code: marker,
          message: "Publisher Grant Authority 拒绝该请求。",
          retryable: false,
        },
      };
    }
  }
  return null;
}

function exactValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_PUBLISHER_GRANT_DATABASE_CONTRACT_INVALID",
      "Publisher Grant RPC 必须返回唯一结果。",
      false,
    );
  }
  return rows[0].value;
}

async function verifyResult(
  command: CreateSemanticPublisherGrantCommand,
  input: unknown,
): Promise<CreateSemanticPublisherGrantResult> {
  const parsed = createSemanticPublisherGrantResultSchema.safeParse(input);
  if (!parsed.success || parsed.data.request_hash !== (await sha256ContentHash(command))) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_PUBLISHER_GRANT_DATABASE_CONTRACT_INVALID",
      "Publisher Grant RPC 返回值未通过 strict schema 或 request hash 校验。",
      false,
    );
  }
  return parsed.data;
}

export function createPostgresPrivilegedGrantAuthority(
  options: PostgresPrivilegedGrantAuthorityOptions,
): PostgresPrivilegedGrantAuthority {
  const teamStore = createPostgresTeamRunStore(options);
  return {
    issueTaskCapability(capabilityInput, commandInput) {
      return teamStore.issueTaskCapability(capabilityInput, commandInput);
    },
    async createPublisherGrant(capabilityInput, commandInput) {
      const parsed = createSemanticPublisherGrantCommandSchema.safeParse(commandInput);
      if (!parsed.success) return invalid("Publisher Grant command 不符合严格契约。");
      const command = parsed.data;
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "semantic.create_bootstrap_publisher_grant",
          correlation_id: command.command_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
            command.semantic_domain,
          ]);
          const result = await client.query<JsonValueRow>(
            "select semantic.create_semantic_bootstrap_publisher_grant($1::jsonb) as value",
            [command],
          );
          return verifyResult(command, exactValue(result.rows));
        },
      );
    },
  };
}
