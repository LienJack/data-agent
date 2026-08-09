import {
  immutableIdSchema,
  type PortResult,
  type SemanticExplorerDomainSummary,
  type SemanticExplorerRawCandidateComparison,
  type SemanticExplorerRawSourceEnvelope,
  type SemanticExplorerReleaseTimeline,
  semanticExplorerDomainSummarySchema,
  semanticExplorerRawCandidateComparisonSchema,
  semanticExplorerRawSourceEnvelopeSchema,
  semanticExplorerReleaseTimelineSchema,
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
const semanticDomainListSchema = z.array(semanticDomainSchema).min(1).max(256);
const releasePageInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  limit: z.number().int().min(1).max(100).default(50),
  generation_cursor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
});
const exactReleaseInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  release_id: immutableIdSchema,
});
const candidateComparisonInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
});
const domainSummaryListSchema = z.array(semanticExplorerDomainSummarySchema);

interface JsonValueRow {
  readonly value: unknown;
}

export interface SemanticExplorerReleasePageInput {
  readonly semantic_domain: string;
  readonly limit?: number;
  readonly generation_cursor?: number | null;
}

export interface SemanticExplorerExactReleaseInput {
  readonly semantic_domain: string;
  readonly release_id: string;
}

export interface SemanticExplorerCandidateComparisonInput {
  readonly semantic_domain: string;
  readonly candidate_id: string;
  readonly revision_id: string;
}

export interface PostgresSemanticExplorerReader {
  listDomains(
    capability: unknown,
    semanticDomains: readonly string[],
  ): Promise<PortResult<readonly SemanticExplorerDomainSummary[]>>;
  getActiveSource(
    capability: unknown,
    semanticDomain: string,
  ): Promise<PortResult<SemanticExplorerRawSourceEnvelope>>;
  getReleaseSource(
    capability: unknown,
    input: SemanticExplorerExactReleaseInput,
  ): Promise<PortResult<SemanticExplorerRawSourceEnvelope>>;
  listReleases(
    capability: unknown,
    input: SemanticExplorerReleasePageInput,
  ): Promise<PortResult<SemanticExplorerReleaseTimeline>>;
  getCandidateComparison(
    capability: unknown,
    input: SemanticExplorerCandidateComparisonInput,
  ): Promise<PortResult<SemanticExplorerRawCandidateComparison>>;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  switch (message) {
    case "SEMANTIC_EXPLORER_SCOPE_FORBIDDEN":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_EXPLORER_PERMISSION_DENIED",
          message: "当前 Authority 不允许读取该语义域。",
          retryable: false,
        },
      };
    case "SEMANTIC_EXPLORER_ACTIVE_RELEASE_NOT_FOUND":
    case "SEMANTIC_EXPLORER_RELEASE_NOT_FOUND":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_EXPLORER_RELEASE_NOT_FOUND",
          message: "语义版本不存在或不在当前 Authority scope 内。",
          retryable: false,
        },
      };
    case "SEMANTIC_EXPLORER_CANDIDATE_NOT_FOUND":
    case "SEMANTIC_EXPLORER_CANDIDATE_CONTRACT_INVALID":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID",
          message: "候选对比不存在或不符合权威契约。",
          retryable: false,
        },
      };
    case "SEMANTIC_EXPLORER_PROJECTION_MISSING":
    case "SEMANTIC_EXPLORER_PROJECTION_IDENTITY_MISMATCH":
    case "SEMANTIC_EXPLORER_RELEASE_IDENTITY_MISMATCH":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH",
          message: "语义版本与其权威投影绑定不一致。",
          retryable: false,
        },
      };
    case "SEMANTIC_EXPLORER_CONTRACT_INVALID":
    case "SEMANTIC_EXPLORER_POINTER_OBSERVATION_MISSING":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
          message: "语义 Explorer 权威读取结果不符合契约。",
          retryable: false,
        },
      };
    default:
      return null;
  }
}

function resultValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
      "语义 Explorer RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

function parseRpcResult<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(code, "语义 Explorer RPC 返回了无效契约。", false);
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

async function setSemanticDomainAllowlist(
  client: { query(text: string, values?: readonly unknown[]): Promise<unknown> },
  semanticDomains: readonly string[],
): Promise<void> {
  await client.query("select pg_catalog.set_config('app.semantic_allowed_domains', $1, true)", [
    semanticDomains.join(","),
  ]);
}

export function createPostgresSemanticExplorerReader(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
): PostgresSemanticExplorerReader {
  return {
    async listDomains(capabilityInput, semanticDomainInput) {
      const semanticDomains = [
        ...new Set(semanticDomainListSchema.parse(semanticDomainInput)),
      ].sort();
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.list_explorer_domains",
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomainAllowlist(client, semanticDomains);
          const query = await client.query<JsonValueRow>(
            `select semantic.list_explorer_domains(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text[]
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomains,
            ],
          );
          return parseRpcResult(
            domainSummaryListSchema,
            resultValue(query.rows),
            "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
          );
        },
      );
    },

    async getActiveSource(capabilityInput, semanticDomainInput) {
      const semanticDomain = semanticDomainSchema.parse(semanticDomainInput);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.get_active_explorer_source",
          correlation_id: semanticDomain,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, semanticDomain);
          const query = await client.query<JsonValueRow>(
            `select semantic.get_active_explorer_source(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
            ],
          );
          return parseRpcResult(
            semanticExplorerRawSourceEnvelopeSchema,
            resultValue(query.rows),
            "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
          );
        },
      );
    },

    async getReleaseSource(capabilityInput, input) {
      const exactRelease = exactReleaseInputSchema.parse(input);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.get_release_explorer_source",
          correlation_id: exactRelease.release_id,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, exactRelease.semantic_domain);
          const query = await client.query<JsonValueRow>(
            `select semantic.get_release_explorer_source(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              exactRelease.semantic_domain,
              exactRelease.release_id,
            ],
          );
          return parseRpcResult(
            semanticExplorerRawSourceEnvelopeSchema,
            resultValue(query.rows),
            "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
          );
        },
      );
    },

    async listReleases(capabilityInput, input) {
      const page = releasePageInputSchema.parse(input);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.list_explorer_releases",
          correlation_id: page.semantic_domain,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, page.semantic_domain);
          const query = await client.query<JsonValueRow>(
            `select semantic.list_explorer_releases(
               $1::uuid, $2::uuid, $3::text, $4::uuid,
               $5::text, $6::integer, $7::bigint
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              page.semantic_domain,
              page.limit,
              page.generation_cursor,
            ],
          );
          return parseRpcResult(
            semanticExplorerReleaseTimelineSchema,
            resultValue(query.rows),
            "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
          );
        },
      );
    },

    async getCandidateComparison(capabilityInput, input) {
      const comparison = candidateComparisonInputSchema.parse(input);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.get_candidate_explorer_comparison",
          correlation_id: comparison.candidate_id,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, comparison.semantic_domain);
          const query = await client.query<JsonValueRow>(
            `select semantic.get_candidate_explorer_comparison(
               $1::uuid, $2::uuid, $3::text, $4::uuid,
               $5::text, $6::uuid, $7::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              comparison.semantic_domain,
              comparison.candidate_id,
              comparison.revision_id,
            ],
          );
          return parseRpcResult(
            semanticExplorerRawCandidateComparisonSchema,
            resultValue(query.rows),
            "SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID",
          );
        },
      );
    },
  };
}
