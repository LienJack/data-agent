import {
  buildSemanticSuccessorReleaseLoadCommand,
  buildSemanticSuccessorSmokeCommitCommand,
  buildSemanticSuccessorStageLoadCommand,
  type SemanticRuntimeSmokeReceipt,
  type SemanticSuccessorStageEnvelope,
  semanticSuccessorStageEnvelopeSchema,
  verifySemanticRuntimeSmokeReceipt,
  verifySemanticSuccessorStage,
} from "@data-agent/contracts/artifacts";
import { immutableIdSchema } from "@data-agent/contracts/common";
import type { PortResult } from "@data-agent/contracts/ports";
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
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u);
const stageInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  stage_id: immutableIdSchema,
});
const releaseInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  release_id: immutableIdSchema,
});
const commitInputSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  idempotency_key: z.string().trim().min(1).max(256),
  receipt: z.unknown(),
});

interface JsonValueRow {
  readonly value: unknown;
}

export interface SemanticSuccessorStageLocator {
  readonly semantic_domain: string;
  readonly stage_id: string;
}

export interface SemanticSuccessorReleaseLocator {
  readonly semantic_domain: string;
  readonly release_id: string;
}

export interface SemanticSuccessorSmokeCommitInput {
  readonly semantic_domain: string;
  readonly idempotency_key: string;
  readonly receipt: SemanticRuntimeSmokeReceipt;
}

export interface PostgresSemanticSuccessorSmokeAuthority {
  loadStage(
    capability: unknown,
    input: SemanticSuccessorStageLocator,
  ): Promise<PortResult<SemanticSuccessorStageEnvelope>>;
  loadPromotedRelease(
    capability: unknown,
    input: SemanticSuccessorReleaseLocator,
  ): Promise<PortResult<SemanticSuccessorStageEnvelope>>;
  commitSmoke(
    capability: unknown,
    input: SemanticSuccessorSmokeCommitInput,
  ): Promise<PortResult<SemanticRuntimeSmokeReceipt>>;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_SUCCESSOR_SMOKE_IDEMPOTENCY_CONFLICT",
        message: "同一 successor smoke 幂等键已绑定到不同命令。",
        retryable: false,
      },
    };
  }
  if (message.includes("SEMANTIC_SUCCESSOR_PROMOTED_RELEASE_NOT_FOUND")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_SUCCESSOR_PROMOTED_RELEASE_NOT_FOUND",
        message: "未找到与 exact release 对应的已提升 successor envelope。",
        retryable: false,
      },
    };
  }
  if (message.includes("SEMANTIC_SUCCESSOR_STAGE_NOT_FOUND")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_SUCCESSOR_STAGE_NOT_FOUND",
        message: "未找到指定的 semantic successor stage。",
        retryable: false,
      },
    };
  }
  if (message.includes("SCOPE_FORBIDDEN")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_SUCCESSOR_SCOPE_FORBIDDEN",
        message: "当前 Authority 不允许访问该 semantic successor。",
        retryable: false,
      },
    };
  }
  if (
    message.includes("SEMANTIC_RUNTIME_SMOKE_FENCE_MISMATCH") ||
    message.includes("SEMANTIC_SUCCESSOR_FORMAL_RELEASE_BINDING_MISMATCH") ||
    message.includes("SEMANTIC_SUCCESSOR_PROJECTION_SET_INVALID")
  ) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_SUCCESSOR_SMOKE_FENCE_MISMATCH",
        message: "Semantic successor smoke 的 exact stage/release fence 不匹配。",
        retryable: false,
      },
    };
  }
  if (message.includes("SEMANTIC_SUCCESSOR") && message.includes("INVALID")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_SUCCESSOR_SMOKE_COMMAND_INVALID",
        message: "Semantic successor smoke 命令不符合权威契约。",
        retryable: false,
      },
    };
  }
  return null;
}

function oneValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_SUCCESSOR_DATABASE_CONTRACT_INVALID",
      "Semantic successor RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

async function setSemanticDomain(
  client: { query(text: string, values?: readonly unknown[]): Promise<unknown> },
  semanticDomain: string,
): Promise<void> {
  await client.query("select pg_catalog.set_config('app.semantic_domain',$1,true)", [
    semanticDomain,
  ]);
}

async function parseEnvelope(value: unknown): Promise<SemanticSuccessorStageEnvelope> {
  try {
    const envelope = semanticSuccessorStageEnvelopeSchema.parse(value);
    await verifySemanticSuccessorStage(envelope.stage);
    return envelope;
  } catch {
    throw new PersistenceBoundaryError(
      "SEMANTIC_SUCCESSOR_DATABASE_CONTRACT_INVALID",
      "PostgreSQL 返回的 semantic successor envelope 不符合契约。",
    );
  }
}

export function createPostgresSemanticSuccessorSmokeAuthority(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
): PostgresSemanticSuccessorSmokeAuthority {
  return Object.freeze({
    async loadStage(capabilityInput: unknown, input: SemanticSuccessorStageLocator) {
      const locator = stageInputSchema.parse(input);
      const command = await buildSemanticSuccessorStageLoadCommand({
        schema_version: "semantic-successor-stage-load@1.0.0",
        stage_id: locator.stage_id,
      });
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.load_successor_stage",
          correlation_id: locator.stage_id,
          map_database_error: databaseFailure,
        },
        async ({ client }) => {
          await setSemanticDomain(client, locator.semantic_domain);
          const result = await client.query<JsonValueRow>(
            "select semantic.load_semantic_successor_stage($1::jsonb) as value",
            [command],
          );
          return parseEnvelope(oneValue(result.rows));
        },
      );
    },

    async loadPromotedRelease(capabilityInput: unknown, input: SemanticSuccessorReleaseLocator) {
      const locator = releaseInputSchema.parse(input);
      const command = await buildSemanticSuccessorReleaseLoadCommand({
        schema_version: "semantic-successor-release-load@1.0.0",
        semantic_domain: locator.semantic_domain,
        release_id: locator.release_id,
      });
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "semantic.load_promoted_successor_release",
          correlation_id: locator.release_id,
          map_database_error: databaseFailure,
        },
        async ({ client }) => {
          await setSemanticDomain(client, locator.semantic_domain);
          const result = await client.query<JsonValueRow>(
            "select semantic.load_promoted_semantic_successor_release($1::jsonb) as value",
            [command],
          );
          const envelope = await parseEnvelope(oneValue(result.rows));
          if (
            envelope.stage.status !== "PROMOTED" ||
            envelope.stage.scope.semantic_domain !== locator.semantic_domain ||
            envelope.stage.candidate_release.release_id !== locator.release_id
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_SUCCESSOR_DATABASE_CONTRACT_INVALID",
              "Promoted semantic successor 与 exact release locator 不一致。",
            );
          }
          return envelope;
        },
      );
    },

    async commitSmoke(capabilityInput: unknown, input: SemanticSuccessorSmokeCommitInput) {
      const parsed = commitInputSchema.parse(input);
      const receipt = await verifySemanticRuntimeSmokeReceipt(parsed.receipt);
      const command = await buildSemanticSuccessorSmokeCommitCommand({
        schema_version: "semantic-successor-smoke-commit@1.0.0",
        idempotency_key: parsed.idempotency_key,
        stage_id: receipt.stage_id,
        expected_stage_digest: receipt.stage_digest,
        receipt,
      });
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "semantic.commit_successor_smoke",
          correlation_id: receipt.stage_id,
          map_database_error: databaseFailure,
        },
        async ({ client }) => {
          await setSemanticDomain(client, parsed.semantic_domain);
          const result = await client.query<JsonValueRow>(
            "select semantic.commit_semantic_successor_smoke($1::jsonb) as value",
            [command],
          );
          let committed: SemanticRuntimeSmokeReceipt;
          try {
            committed = await verifySemanticRuntimeSmokeReceipt(oneValue(result.rows));
          } catch {
            throw new PersistenceBoundaryError(
              "SEMANTIC_SUCCESSOR_DATABASE_CONTRACT_INVALID",
              "PostgreSQL 返回的 successor smoke receipt 不符合契约。",
            );
          }
          if (
            committed.stage_id !== receipt.stage_id ||
            committed.stage_digest !== receipt.stage_digest ||
            committed.smoke_receipt_hash !== receipt.smoke_receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_SUCCESSOR_DATABASE_CONTRACT_INVALID",
              "PostgreSQL 返回的 successor smoke receipt 绑定不一致。",
            );
          }
          return committed;
        },
      );
    },
  });
}
