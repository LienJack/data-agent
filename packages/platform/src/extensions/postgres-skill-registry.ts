import {
  type PortResult,
  type SkillRegistryItem,
  type SkillRevision,
  skillRegistryItemSchema,
  verifySkillRevision,
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
  kind: z.literal("SKILL"),
  object_id: z.uuid(),
  revision: z.number().int().positive(),
  revision_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  lifecycle: z.enum(["ENABLED", "DISABLED", "QUARANTINED", "REVOKED"]),
  head_version: z.number().int().positive(),
});
const listSchema = z.strictObject({
  schema_version: z.literal("extension-list@1.0.0"),
  kind: z.literal("SKILL"),
  items: z.array(skillRegistryItemSchema),
});
const signerRevocationResultSchema = z.strictObject({
  schema_version: z.literal("skill-signer-revoke-result@1.0.0"),
  disposition: z.enum(["REVOKED", "REPLAYED"]),
  signer_id: z.uuid(),
  revocation_version: z.number().int().positive(),
});

function databaseError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return /^EXTENSION_|^SKILL_/.test(code)
    ? {
        ok: false as const,
        error: {
          code,
          message: "Skill registry rejected the operation.",
          retryable: /VERSION/.test(code),
        },
      }
    : null;
}

export function createPostgresSkillRegistry(options: {
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
        readonly target_lifecycle: "ENABLED" | "DISABLED" | "QUARANTINED" | "REVOKED";
        readonly revision: SkillRevision;
      },
    ): Promise<PortResult<z.infer<typeof resultSchema>>> {
      let revision: SkillRevision;
      try {
        revision = await verifySkillRevision(input.revision);
      } catch {
        return {
          ok: false,
          error: {
            code: "SKILL_REVISION_INVALID",
            message: "Skill revision is invalid.",
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
          operation_name: "extension.skill.commit",
          correlation_id: input.operation_id,
          map_database_error: databaseError,
        },
        async ({ client }) => {
          const command = {
            schema_version: "extension-revision-commit@1.0.0",
            ...input,
            kind: "SKILL",
            revision,
          };
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.commit_extension_revision($1::jsonb) as value",
            [command],
          );
          const parsed = resultSchema.safeParse(query.rows[0]?.value);
          if (
            !parsed.success ||
            parsed.data.object_id !== revision.skill_id ||
            parsed.data.revision_hash !== revision.revision_hash
          ) {
            throw new PersistenceBoundaryError(
              "EXTENSION_DATABASE_CONTRACT_INVALID",
              "Skill registry result was substituted.",
            );
          }
          return parsed.data;
        },
      );
    },
    list(
      capability: unknown,
      enabledOnly = false,
    ): Promise<PortResult<readonly SkillRegistryItem[]>> {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "extension.skill.list",
          correlation_id: "skill-list",
          map_database_error: databaseError,
        },
        async ({ client }) => {
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.list_extension_revisions('SKILL',$1::boolean) as value",
            [enabledOnly],
          );
          const parsed = listSchema.safeParse(query.rows[0]?.value);
          if (!parsed.success)
            throw new PersistenceBoundaryError(
              "EXTENSION_DATABASE_CONTRACT_INVALID",
              "Skill list is invalid.",
            );
          await Promise.all(
            parsed.data.items.map(async (item) => {
              await verifySkillRevision(item.revision);
              if (
                item.head.scope.app_id !== item.revision.scope.app_id ||
                item.head.scope.tenant_id !== item.revision.scope.tenant_id ||
                item.head.scope.environment !== item.revision.scope.environment ||
                item.head.skill_id !== item.revision.skill_id ||
                item.head.active_revision !== item.revision.revision ||
                item.head.active_revision_hash !== item.revision.revision_hash
              ) {
                throw new PersistenceBoundaryError(
                  "EXTENSION_DATABASE_CONTRACT_INVALID",
                  "Skill registry head does not identify its revision.",
                );
              }
            }),
          );
          return parsed.data.items;
        },
      );
    },
    revokeSigner(
      capability: unknown,
      input: {
        readonly operation_id: string;
        readonly idempotency_key: string;
        readonly signer_id: string;
        readonly expected_revocation_version: number;
        readonly reason_code: string;
      },
    ): Promise<PortResult<z.infer<typeof signerRevocationResultSchema>>> {
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "extension.skill.signer.revoke",
          correlation_id: input.operation_id,
          map_database_error: databaseError,
        },
        async ({ client }) => {
          const command = { schema_version: "skill-signer-revoke@1.0.0", ...input };
          const query = await client.query<{ value: unknown }>(
            "select app_data_agent.revoke_skill_signer($1::jsonb) as value",
            [command],
          );
          const parsed = signerRevocationResultSchema.safeParse(query.rows[0]?.value);
          if (!parsed.success || parsed.data.signer_id !== input.signer_id) {
            throw new PersistenceBoundaryError(
              "EXTENSION_DATABASE_CONTRACT_INVALID",
              "Skill signer revocation result was substituted.",
            );
          }
          return parsed.data;
        },
      );
    },
  });
}

export type PostgresSkillRegistry = ReturnType<typeof createPostgresSkillRegistry>;
