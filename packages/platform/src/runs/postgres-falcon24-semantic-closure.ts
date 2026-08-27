import type { PortResult } from "@data-agent/contracts/ports";
import {
  buildFalcon24SemanticAuthorityClosureLoadCommand,
  type Falcon24SemanticAuthorityClosure,
  falcon24SemanticAuthorityClosureSchema,
} from "@data-agent/contracts/runs";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const locatorSchema = z.strictObject({
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u),
});

interface JsonValueRow {
  readonly value: unknown;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND")) {
    return {
      ok: false,
      error: {
        code: "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND",
        message: "当前 scope 尚无完整 Falcon24 semantic authority closure。",
        retryable: false,
      },
    };
  }
  if (message.includes("FALCON24_SEMANTIC_AUTHORITY_CLOSURE_SCOPE_FORBIDDEN")) {
    return {
      ok: false,
      error: {
        code: "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_SCOPE_FORBIDDEN",
        message: "当前 Authority 不允许读取该 semantic domain。",
        retryable: false,
      },
    };
  }
  if (message.includes("FALCON24_SEMANTIC_AUTHORITY_CLOSURE_LOAD_INVALID")) {
    return {
      ok: false,
      error: {
        code: "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_LOAD_INVALID",
        message: "Falcon24 semantic authority closure 读取命令无效。",
        retryable: false,
      },
    };
  }
  if (message.includes("FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID")) {
    return {
      ok: false,
      error: {
        code: "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID",
        message: "PostgreSQL 返回的 Falcon24 semantic authority closure 不符合合同。",
        retryable: false,
      },
    };
  }
  return null;
}

function oneValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID",
      "PostgreSQL 返回的 Falcon24 semantic authority closure 不符合合同。",
    );
  }
  return rows[0]?.value;
}

export function createPostgresFalcon24SemanticClosureReader(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
) {
  return Object.freeze({
    async load(
      capability: unknown,
      input: { readonly semantic_domain: string },
    ): Promise<PortResult<Falcon24SemanticAuthorityClosure>> {
      const locator = locatorSchema.parse(input);
      const command = await buildFalcon24SemanticAuthorityClosureLoadCommand({
        schema_version: "falcon24-semantic-authority-closure-load@1.0.0",
        semantic_domain: locator.semantic_domain,
      });
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capability,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          snapshot: "REPEATABLE_READ",
          operation_name: "falcon24.semantic-authority-closure.load",
          map_database_error: databaseFailure,
        },
        async ({ client }) => {
          await client.query("select pg_catalog.set_config('app.semantic_domain',$1,true)", [
            locator.semantic_domain,
          ]);
          const result = await client.query<JsonValueRow>(
            "select app_data_agent.load_falcon24_semantic_authority_closure($1::jsonb) as value",
            [command],
          );
          try {
            return falcon24SemanticAuthorityClosureSchema.parse(oneValue(result.rows));
          } catch (error) {
            if (error instanceof PersistenceBoundaryError) throw error;
            throw new PersistenceBoundaryError(
              "FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID",
              "PostgreSQL 返回的 Falcon24 semantic authority closure 不符合合同。",
            );
          }
        },
      );
    },
  });
}

export type PostgresFalcon24SemanticClosureReader = ReturnType<
  typeof createPostgresFalcon24SemanticClosureReader
>;
