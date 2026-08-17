import {
  type PortResult,
  type ToolEffectIntent,
  type ToolEffectTransition,
  toolEffectStateSchema,
  verifyToolEffectIntent,
  verifyToolEffectTransition,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const resultSchema = z.strictObject({
  schema_version: z.literal("tool-effect-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED", "APPLIED"]),
  effect_id: z.uuid(),
  state: toolEffectStateSchema,
  version: z.number().int().positive(),
  intent_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

function databaseError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return /^(TOOL_EFFECT_|MCP_)/.test(code)
    ? {
        ok: false as const,
        error: {
          code,
          message: "Tool effect authority rejected the operation.",
          retryable: /STALE|CONFLICT/.test(code),
        },
      }
    : null;
}

export function createPostgresToolEffectStore(options: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  return Object.freeze({
    async begin(
      capability: unknown,
      input: ToolEffectIntent,
    ): Promise<PortResult<z.infer<typeof resultSchema>>> {
      let intent: ToolEffectIntent;
      try {
        intent = await verifyToolEffectIntent(input);
      } catch {
        return {
          ok: false,
          error: {
            code: "TOOL_EFFECT_INTENT_INVALID",
            message: "Tool effect intent is invalid.",
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
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "extension.tool.effect.begin",
          correlation_id: intent.effect_id,
          map_database_error: databaseError,
        },
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.begin_tool_effect($1::jsonb) as value",
            [intent],
          );
          const parsed = resultSchema.safeParse(query.rows[0]?.value);
          if (
            !parsed.success ||
            parsed.data.effect_id !== intent.effect_id ||
            parsed.data.intent_hash !== intent.intent_hash ||
            parsed.data.state !== "INTENT_COMMITTED"
          ) {
            throw new PersistenceBoundaryError(
              "EXTENSION_DATABASE_CONTRACT_INVALID",
              "Tool effect begin result was substituted.",
            );
          }
          return parsed.data;
        },
      );
    },
    async transition(
      capability: unknown,
      input: ToolEffectTransition,
    ): Promise<PortResult<z.infer<typeof resultSchema>>> {
      let transition: ToolEffectTransition;
      try {
        transition = await verifyToolEffectTransition(input);
      } catch {
        return {
          ok: false,
          error: {
            code: "TOOL_EFFECT_TRANSITION_INVALID",
            message: "Tool effect transition is invalid.",
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
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "extension.tool.effect.transition",
          correlation_id: transition.transition_id,
          map_database_error: databaseError,
        },
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.transition_tool_effect($1::jsonb) as value",
            [transition],
          );
          const parsed = resultSchema.safeParse(query.rows[0]?.value);
          if (
            !parsed.success ||
            parsed.data.effect_id !== transition.effect_id ||
            parsed.data.state !== transition.target_state
          ) {
            throw new PersistenceBoundaryError(
              "EXTENSION_DATABASE_CONTRACT_INVALID",
              "Tool effect transition result was substituted.",
            );
          }
          return parsed.data;
        },
      );
    },
  });
}

export type PostgresToolEffectStore = ReturnType<typeof createPostgresToolEffectStore>;
