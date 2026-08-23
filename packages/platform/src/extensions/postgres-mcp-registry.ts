import {
  type McpServerRegistryItem,
  type McpServerRevision,
  mcpServerRegistryItemSchema,
  type PortResult,
  verifyMcpServerRevision,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const resultSchema = z.strictObject({
  schema_version: z.literal("extension-revision-result@1.0.0"),
  disposition: z.enum(["COMMITTED", "REPLAYED"]),
  kind: z.literal("MCP_SERVER"),
  object_id: z.uuid(),
  revision: z.number().int().positive(),
  revision_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  lifecycle: z.enum(["ENABLED", "DISABLED", "REVOKED"]),
  head_version: z.number().int().positive(),
});
const listSchema = z.strictObject({
  schema_version: z.literal("extension-list@1.0.0"),
  kind: z.literal("MCP_SERVER"),
  items: z.array(mcpServerRegistryItemSchema),
});

function databaseError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return /^EXTENSION_|^MCP_/.test(code)
    ? {
        ok: false as const,
        error: {
          code,
          message: "MCP registry rejected the operation.",
          retryable: /VERSION/.test(code),
        },
      }
    : null;
}

export function createPostgresMcpRegistry(options: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  return Object.freeze({
    async commit(
      capability: unknown,
      input: {
        readonly operation_id: string;
        readonly idempotency_key: string;
        readonly expected_head_version: number | null;
        readonly target_lifecycle: "ENABLED" | "DISABLED" | "REVOKED";
        readonly revision: McpServerRevision;
      },
    ): Promise<PortResult<z.infer<typeof resultSchema>>> {
      let revision: McpServerRevision;
      try {
        revision = await verifyMcpServerRevision(input.revision);
      } catch {
        return {
          ok: false,
          error: {
            code: "MCP_SERVER_REVISION_INVALID",
            message: "MCP revision is invalid.",
            retryable: false,
          },
        };
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "extension.mcp.commit",
          correlation_id: input.operation_id,
          map_database_error: databaseError,
        },
        async ({ client }) => {
          const command = {
            schema_version: "extension-revision-commit@1.0.0",
            ...input,
            kind: "MCP_SERVER",
            revision,
          };
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_extension_revision($1::jsonb) as value",
            [command],
          );
          const parsed = resultSchema.safeParse(query.rows[0]?.value);
          if (
            !parsed.success ||
            parsed.data.object_id !== revision.server_id ||
            parsed.data.revision_hash !== revision.revision_hash
          ) {
            throw new PersistenceBoundaryError(
              "EXTENSION_DATABASE_CONTRACT_INVALID",
              "MCP registry result was substituted.",
            );
          }
          return parsed.data;
        },
      );
    },
    list(
      capability: unknown,
      enabledOnly = false,
    ): Promise<PortResult<readonly McpServerRegistryItem[]>> {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "extension.mcp.list",
          correlation_id: "mcp-server-list",
          map_database_error: databaseError,
        },
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.list_extension_revisions('MCP_SERVER',$1::boolean) as value",
            [enabledOnly],
          );
          const parsed = listSchema.safeParse(query.rows[0]?.value);
          if (!parsed.success)
            throw new PersistenceBoundaryError(
              "EXTENSION_DATABASE_CONTRACT_INVALID",
              "MCP list is invalid.",
            );
          await Promise.all(
            parsed.data.items.map(async (item) => {
              await verifyMcpServerRevision(item.revision);
              if (
                item.head.scope.app_id !== item.revision.scope.app_id ||
                item.head.scope.tenant_id !== item.revision.scope.tenant_id ||
                item.head.scope.environment !== item.revision.scope.environment ||
                item.head.server_id !== item.revision.server_id ||
                item.head.active_revision !== item.revision.revision ||
                item.head.active_revision_hash !== item.revision.revision_hash
              ) {
                throw new PersistenceBoundaryError(
                  "EXTENSION_DATABASE_CONTRACT_INVALID",
                  "MCP registry head does not identify its revision.",
                );
              }
            }),
          );
          return parsed.data.items;
        },
      );
    },
  });
}

export type PostgresMcpRegistry = ReturnType<typeof createPostgresMcpRegistry>;
