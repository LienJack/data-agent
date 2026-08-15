import {
  immutableIdSchema,
  type PortResult,
  type SemanticGraphProjection,
  type SemanticGraphProjectionReceipt,
  type SemanticGraphReleaseBinding,
  type SemanticGraphStudioSource,
  semanticGraphProjectionReceiptSchema,
  semanticGraphProjectionSchema,
  semanticGraphReleaseBindingSchema,
  semanticGraphStudioSourceSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const commitInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  projection_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  projection: semanticGraphProjectionSchema,
});
const bindInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  release_id: immutableIdSchema,
  projection_id: immutableIdSchema,
});

interface JsonValueRow {
  readonly value: unknown;
}

export interface SemanticGraphProjectionCommitInput {
  readonly semantic_domain: string;
  readonly projection_id: string;
  readonly source_revision_id: string;
  readonly projection: SemanticGraphProjection;
}

export interface SemanticGraphReleaseBindingInput {
  readonly semantic_domain: string;
  readonly release_id: string;
  readonly projection_id: string;
}

export interface PostgresSemanticGraphStore {
  commit(
    capability: unknown,
    input: SemanticGraphProjectionCommitInput,
  ): Promise<PortResult<SemanticGraphProjectionReceipt>>;
  get(
    capability: unknown,
    semanticDomain: string,
    projectionId: string,
  ): Promise<PortResult<SemanticGraphProjection | null>>;
  getActive(
    capability: unknown,
    semanticDomain: string,
  ): Promise<PortResult<SemanticGraphStudioSource | null>>;
  bindRelease(
    capability: unknown,
    input: SemanticGraphReleaseBindingInput,
  ): Promise<PortResult<SemanticGraphReleaseBinding>>;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("IDEMPOTENCY_CONFLICT")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_GRAPH_PROJECTION_CONFLICT",
        message: "该投影 ID 已绑定到不同的 Graph 内容。",
        retryable: false,
      },
    };
  }
  if (message.includes("SCOPE_FORBIDDEN")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_GRAPH_PROJECTION_PERMISSION_DENIED",
        message: "当前 Authority 不允许访问该语义域的 Graph 投影。",
        retryable: false,
      },
    };
  }
  if (message.includes("NOT_FOUND")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_GRAPH_PROJECTION_NOT_FOUND",
        message: "Graph source、projection 或 release 不存在。",
        retryable: false,
      },
    };
  }
  if (message.includes("RELEASE_MISMATCH") || message.includes("DIGEST_MISMATCH")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_GRAPH_PROJECTION_AUTHORITY_MISMATCH",
        message: "Graph 投影与 source/release Authority 不一致。",
        retryable: false,
      },
    };
  }
  if (message.includes("INVALID")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_GRAPH_PROJECTION_INVALID",
        message: "Graph 投影不符合权威持久化契约。",
        retryable: false,
      },
    };
  }
  return null;
}

function oneValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_GRAPH_PROJECTION_DATABASE_CONTRACT_INVALID",
      "Graph projection RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_GRAPH_PROJECTION_DATABASE_CONTRACT_INVALID",
      "Graph projection RPC 返回了无效契约。",
      false,
    );
  }
  return parsed.data;
}

async function setSemanticDomain(
  client: { query(text: string, values?: readonly unknown[]): Promise<unknown> },
  semanticDomain: string,
): Promise<void> {
  await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
    semanticDomain,
  ]);
}

export function createPostgresSemanticGraphStore(
  options: Readonly<{ pool: SqlPool; authorizer: TransactionalCapabilityAuthorizer }>,
): PostgresSemanticGraphStore {
  const transaction = async <T>(
    capability: unknown,
    access: "READ" | "WRITE",
    operationName: string,
    semanticDomain: string,
    work: Parameters<typeof withAppTransaction<T>>[4],
  ): Promise<PortResult<T>> =>
    withAppTransaction(
      options.pool,
      options.authorizer,
      capability,
      {
        access,
        operation_name: operationName,
        correlation_id: semanticDomain,
        map_database_error: databaseFailure,
      },
      async (context) => {
        await setSemanticDomain(context.client, semanticDomain);
        return work(context);
      },
    );

  return {
    async commit(capability, input) {
      const commit = commitInputSchema.parse(input);
      return transaction(
        capability,
        "WRITE",
        "semantic.commit_semantic_graph_projection",
        commit.semantic_domain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.commit_semantic_graph_projection(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::uuid, $8::jsonb
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              commit.semantic_domain,
              commit.projection_id,
              commit.source_revision_id,
              commit.projection,
            ],
          );
          return parseValue(semanticGraphProjectionReceiptSchema, oneValue(result.rows));
        },
      );
    },

    async get(capability, semanticDomainInput, projectionIdInput) {
      const semanticDomain = semanticDomainSchema.parse(semanticDomainInput);
      const projectionId = immutableIdSchema.parse(projectionIdInput);
      return transaction(
        capability,
        "READ",
        "semantic.get_semantic_graph_projection",
        semanticDomain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.get_semantic_graph_projection(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              semanticDomain,
              projectionId,
            ],
          );
          const value = oneValue(result.rows);
          return value === null ? null : parseValue(semanticGraphProjectionSchema, value);
        },
      );
    },

    async getActive(capability, semanticDomainInput) {
      const semanticDomain = semanticDomainSchema.parse(semanticDomainInput);
      return transaction(
        capability,
        "READ",
        "semantic.get_active_semantic_graph_studio",
        semanticDomain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.get_active_semantic_graph_studio(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              semanticDomain,
            ],
          );
          const value = oneValue(result.rows);
          return value === null ? null : parseValue(semanticGraphStudioSourceSchema, value);
        },
      );
    },

    async bindRelease(capability, input) {
      const binding = bindInputSchema.parse(input);
      return transaction(
        capability,
        "WRITE",
        "semantic.bind_semantic_graph_release",
        binding.semantic_domain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.bind_semantic_graph_release(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid, $7::uuid
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              binding.semantic_domain,
              binding.release_id,
              binding.projection_id,
            ],
          );
          return parseValue(semanticGraphReleaseBindingSchema, oneValue(result.rows));
        },
      );
    },
  };
}
