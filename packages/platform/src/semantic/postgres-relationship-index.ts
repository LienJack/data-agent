import {
  immutableIdSchema,
  type PortResult,
  type SemanticRelationshipIndexCheckpoint,
  type SemanticRelationshipIndexReasonCode,
  semanticRelationshipIndexCheckpointSchema,
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
const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const claimInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  worker_id: immutableIdSchema,
  lease_seconds: z.number().int().min(5).max(900),
});
const attemptInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  attempt_id: immutableIdSchema,
  attempt_fence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  worker_id: immutableIdSchema,
});
const heartbeatInputSchema = attemptInputSchema.extend({
  lease_seconds: z.number().int().min(5).max(900),
});
const commitInputSchema = attemptInputSchema.extend({
  build_id: immutableIdSchema,
  manifest_digest: contentHashSchema,
  release_digest: contentHashSchema,
  relationship_projection_digest: contentHashSchema,
  node_count: z.number().int().min(0).max(10_000_000),
  edge_count: z.number().int().min(0).max(20_000_000),
});
const reasonCodeSchema = z.enum([
  "INDEX_UNAVAILABLE",
  "INDEX_DIGEST_MISMATCH",
  "INDEX_BUILD_FAILED",
  "INDEX_LEASE_EXPIRED",
  "INDEX_ATTEMPT_STALE",
  "AUTHORITY_CHANGED",
]);
const failInputSchema = attemptInputSchema.extend({ reason_code: reasonCodeSchema });
const checkpointInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  release_id: immutableIdSchema,
});
const requeueInputSchema = checkpointInputSchema.extend({
  expected_build_id: immutableIdSchema,
  expected_manifest_digest: contentHashSchema,
  reason_code: z.enum(["INDEX_NOT_READY", "INDEX_DIGEST_MISMATCH"]),
});
const relationshipIndexClaimSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  release_id: immutableIdSchema,
  release_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  release_digest: contentHashSchema,
  relationship_projection_id: immutableIdSchema,
  relationship_projection_digest: contentHashSchema,
  attempt_id: immutableIdSchema,
  attempt_fence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  worker_id: immutableIdSchema,
  lease_expires_at: z.iso.datetime({ offset: true }),
});

type RelationshipIndexClaim = z.infer<typeof relationshipIndexClaimSchema>;
type ClaimInput = z.infer<typeof claimInputSchema>;
type HeartbeatInput = z.infer<typeof heartbeatInputSchema>;
type CommitInput = z.infer<typeof commitInputSchema>;
type FailInput = z.infer<typeof failInputSchema>;

interface JsonValueRow {
  readonly value: unknown;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  switch (message) {
    case "SEMANTIC_EXPLORER_SCOPE_FORBIDDEN":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_RELATIONSHIP_INDEX_PERMISSION_DENIED",
          message: "当前 Authority 不允许访问该语义域的关系索引状态。",
          retryable: false,
        },
      };
    case "SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE",
          message: "关系索引租约已失效或 fencing token 不再有效。",
          retryable: false,
        },
      };
    case "SEMANTIC_RELATIONSHIP_INDEX_AUTHORITY_CHANGED":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_RELATIONSHIP_INDEX_AUTHORITY_CHANGED",
          message: "PostgreSQL 权威版本已变化，当前索引结果不能提交。",
          retryable: false,
        },
      };
    case "SEMANTIC_RELATIONSHIP_INDEX_CLAIM_INVALID":
    case "SEMANTIC_RELATIONSHIP_INDEX_HEARTBEAT_INVALID":
    case "SEMANTIC_RELATIONSHIP_INDEX_COMMIT_INVALID":
    case "SEMANTIC_RELATIONSHIP_INDEX_REQUEUE_INVALID":
    case "SEMANTIC_RELATIONSHIP_INDEX_REASON_INVALID":
      return {
        ok: false,
        error: {
          code: "SEMANTIC_RELATIONSHIP_INDEX_INPUT_INVALID",
          message: "关系索引作业参数不符合权威契约。",
          retryable: false,
        },
      };
    default:
      return null;
  }
}

function oneValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_RELATIONSHIP_INDEX_CONTRACT_INVALID",
      "关系索引 RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_RELATIONSHIP_INDEX_CONTRACT_INVALID",
      "关系索引 RPC 返回了无效契约。",
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

export interface PostgresRelationshipIndexStore {
  reconcile(capability: unknown, semanticDomain: string): Promise<PortResult<number>>;
  claim(capability: unknown, input: ClaimInput): Promise<PortResult<RelationshipIndexClaim | null>>;
  heartbeat(capability: unknown, input: HeartbeatInput): Promise<PortResult<string>>;
  commit(
    capability: unknown,
    input: CommitInput,
  ): Promise<PortResult<SemanticRelationshipIndexCheckpoint>>;
  fail(capability: unknown, input: FailInput): Promise<PortResult<void>>;
  getCheckpoint(
    capability: unknown,
    input: { readonly semantic_domain: string; readonly release_id: string },
  ): Promise<PortResult<SemanticRelationshipIndexCheckpoint | null>>;
  requeue(
    capability: unknown,
    input: z.infer<typeof requeueInputSchema>,
  ): Promise<PortResult<SemanticRelationshipIndexCheckpoint>>;
}

export function createPostgresRelationshipIndexStore(
  options: Readonly<{ pool: SqlPool; authorizer: TransactionalCapabilityAuthorizer }>,
): PostgresRelationshipIndexStore {
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
    async reconcile(capability, semanticDomainInput) {
      const semanticDomain = semanticDomainSchema.parse(semanticDomainInput);
      return transaction(
        capability,
        "WRITE",
        "semantic.reconcile_relationship_index_jobs",
        semanticDomain,
        async ({ capability: current, client }) => {
          const result = await client.query<{ readonly value: number }>(
            `select semantic.reconcile_relationship_index_jobs(
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
          return z.number().int().min(0).parse(result.rows[0]?.value);
        },
      );
    },

    async claim(capability, input) {
      const claim = claimInputSchema.parse(input);
      return transaction(
        capability,
        "WRITE",
        "semantic.claim_relationship_index_job",
        claim.semantic_domain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.claim_relationship_index_job(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid, $7::integer
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              claim.semantic_domain,
              claim.worker_id,
              claim.lease_seconds,
            ],
          );
          const value = oneValue(result.rows);
          return value === null ? null : parseValue(relationshipIndexClaimSchema, value);
        },
      );
    },

    async heartbeat(capability, input) {
      const heartbeat = heartbeatInputSchema.parse(input);
      return transaction(
        capability,
        "WRITE",
        "semantic.heartbeat_relationship_index_attempt",
        heartbeat.semantic_domain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.heartbeat_relationship_index_attempt(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::bigint, $8::uuid, $9::integer
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              heartbeat.semantic_domain,
              heartbeat.attempt_id,
              heartbeat.attempt_fence,
              heartbeat.worker_id,
              heartbeat.lease_seconds,
            ],
          );
          return z.iso.datetime({ offset: true }).parse(oneValue(result.rows));
        },
      );
    },

    async commit(capability, input) {
      const commit = commitInputSchema.parse(input);
      return transaction(
        capability,
        "WRITE",
        "semantic.commit_relationship_index_attempt",
        commit.semantic_domain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.commit_relationship_index_attempt(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::bigint, $8::uuid, $9::uuid,
               $10::text, $11::text, $12::text, $13::integer, $14::integer
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              commit.semantic_domain,
              commit.attempt_id,
              commit.attempt_fence,
              commit.worker_id,
              commit.build_id,
              commit.manifest_digest,
              commit.release_digest,
              commit.relationship_projection_digest,
              commit.node_count,
              commit.edge_count,
            ],
          );
          return parseValue(semanticRelationshipIndexCheckpointSchema, oneValue(result.rows));
        },
      );
    },

    async fail(capability, input) {
      const failure = failInputSchema.parse(input);
      return transaction(
        capability,
        "WRITE",
        "semantic.fail_relationship_index_attempt",
        failure.semantic_domain,
        async ({ capability: current, client }) => {
          await client.query(
            `select semantic.fail_relationship_index_attempt(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::bigint, $8::uuid, $9::text
             )`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              failure.semantic_domain,
              failure.attempt_id,
              failure.attempt_fence,
              failure.worker_id,
              failure.reason_code satisfies SemanticRelationshipIndexReasonCode,
            ],
          );
        },
      );
    },

    async getCheckpoint(capability, input) {
      const checkpoint = checkpointInputSchema.parse(input);
      return transaction(
        capability,
        "READ",
        "semantic.get_relationship_index_checkpoint",
        checkpoint.semantic_domain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.get_relationship_index_checkpoint(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              checkpoint.semantic_domain,
              checkpoint.release_id,
            ],
          );
          const value = oneValue(result.rows);
          return value === null
            ? null
            : parseValue(semanticRelationshipIndexCheckpointSchema, value);
        },
      );
    },

    async requeue(capability, input) {
      const requeue = requeueInputSchema.parse(input);
      return transaction(
        capability,
        "WRITE",
        "semantic.requeue_relationship_index_release",
        requeue.semantic_domain,
        async ({ capability: current, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.requeue_relationship_index_release(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::uuid, $8::text, $9::text
             ) as value`,
            [
              current.scope.app_id,
              current.scope.tenant_id,
              current.scope.environment,
              current.principal,
              requeue.semantic_domain,
              requeue.release_id,
              requeue.expected_build_id,
              requeue.expected_manifest_digest,
              requeue.reason_code,
            ],
          );
          return parseValue(semanticRelationshipIndexCheckpointSchema, oneValue(result.rows));
        },
      );
    },
  };
}
