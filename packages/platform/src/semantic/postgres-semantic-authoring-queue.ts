import {
  type PortResult,
  type SemanticAuthoringQueuePort,
  semanticAuthoringClaimSchema,
  semanticAuthoringLeaseSchema,
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
const workerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);
const leaseDurationSchema = z.number().int().min(5_000).max(900_000);

interface JsonValueRow {
  readonly value: unknown;
}

function oneValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_AUTHORING_QUEUE_DATABASE_CONTRACT_INVALID",
      "Semantic authoring queue RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("SCOPE_FORBIDDEN") || message.includes("PERMISSION")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_QUEUE_PERMISSION_DENIED",
        message: "当前 Authority 不允许领取该语义创作任务。",
        retryable: false,
      },
    };
  }
  if (message.includes("LEASE_STALE") || message.includes("CONFLICT")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_LEASE_STALE",
        message: "语义创作租约已失效，Worker 必须停止写入并重新领取。",
        retryable: true,
      },
    };
  }
  if (message.includes("INVALID")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_QUEUE_INPUT_INVALID",
        message: "语义创作队列请求不符合权威契约。",
        retryable: false,
      },
    };
  }
  return null;
}

export interface PostgresSemanticAuthoringQueueOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: unknown;
  readonly semantic_domain: string;
}

export function createPostgresSemanticAuthoringQueue(
  options: PostgresSemanticAuthoringQueueOptions,
): SemanticAuthoringQueuePort {
  const semanticDomain = semanticDomainSchema.parse(options.semantic_domain);
  const transaction = async <T>(
    operationName: string,
    work: Parameters<typeof withAppTransaction<T>>[4],
  ): Promise<PortResult<T>> =>
    withAppTransaction(
      options.pool,
      options.authorizer,
      options.capability,
      {
        access: "WRITE",
        operation_name: operationName,
        correlation_id: semanticDomain,
        map_database_error: databaseFailure,
      },
      async (context) => {
        await context.client.query(
          "select pg_catalog.set_config('app.semantic_domain', $1, true)",
          [semanticDomain],
        );
        return work(context);
      },
    );

  const queue: SemanticAuthoringQueuePort = {
    async claimNext(input) {
      const workerId = workerIdSchema.parse(input.worker_id);
      const leaseDurationMs = leaseDurationSchema.parse(input.lease_duration_ms);
      return transaction(
        "semantic.claim_semantic_authoring_run",
        async ({ capability, client }) => {
          if (
            input.scope.app_id !== capability.scope.app_id ||
            input.scope.tenant_id !== capability.scope.tenant_id ||
            input.scope.environment !== capability.scope.environment
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_AUTHORING_QUEUE_SCOPE_MISMATCH",
              "Claim input Scope 与 Authority 不一致。",
            );
          }
          const result = await client.query<JsonValueRow>(
            `select semantic.claim_semantic_authoring_run(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::integer
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              workerId,
              leaseDurationMs,
            ],
          );
          const value = oneValue(result.rows);
          return value === null ? null : semanticAuthoringClaimSchema.parse(value);
        },
      );
    },

    async heartbeat(input) {
      const lease = semanticAuthoringLeaseSchema.parse(input.lease);
      const leaseDurationMs = leaseDurationSchema.parse(input.lease_duration_ms);
      if (lease.semantic_domain !== semanticDomain) {
        return {
          ok: false,
          error: {
            code: "SEMANTIC_AUTHORING_DOMAIN_MISMATCH",
            message: "Lease 与绑定的 semantic domain 不一致。",
            retryable: false,
          },
        };
      }
      return transaction(
        "semantic.heartbeat_semantic_authoring_run",
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.heartbeat_semantic_authoring_run(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
               $7::text,$8::uuid,$9::bigint,$10::integer
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              lease.authoring_run_id,
              lease.worker_id,
              lease.lease_token,
              lease.writer_fence,
              leaseDurationMs,
            ],
          );
          return semanticAuthoringLeaseSchema.parse(oneValue(result.rows));
        },
      );
    },

    async release(input) {
      const lease = semanticAuthoringLeaseSchema.parse(input.lease);
      if (lease.semantic_domain !== semanticDomain) {
        return {
          ok: false,
          error: {
            code: "SEMANTIC_AUTHORING_DOMAIN_MISMATCH",
            message: "Lease 与绑定的 semantic domain 不一致。",
            retryable: false,
          },
        };
      }
      return transaction(
        "semantic.release_semantic_authoring_run",
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.release_semantic_authoring_run(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,
               $7::text,$8::uuid,$9::bigint
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              lease.authoring_run_id,
              lease.worker_id,
              lease.lease_token,
              lease.writer_fence,
            ],
          );
          if (oneValue(result.rows) !== true) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_AUTHORING_LEASE_RELEASE_INVALID",
              "Semantic authoring lease release RPC 返回无效结果。",
            );
          }
          return null;
        },
      );
    },
  };
  return Object.freeze(queue);
}
