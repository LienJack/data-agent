import {
  contentHashSchema,
  immutableIdSchema,
  type PortResult,
  type SchemaFeaturePacket,
  type SemanticAgentReceipt,
  type SemanticChangeProposal,
  schemaDriftEventSchema,
  schemaFeaturePacketSchema,
  semanticAgentReceiptSchema,
  semanticChangeProposalSchema,
  semanticCompileTerminalSchema,
  timestampSchema,
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
const compileStateSchema = z.union([z.literal("RUNNING"), semanticCompileTerminalSchema]);
const beginResultSchema = z.strictObject({
  compile_run_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  terminal: compileStateSchema,
  proposal_digest: contentHashSchema.nullable(),
  created: z.boolean(),
});
const finishResultSchema = z.strictObject({
  compile_run_id: immutableIdSchema,
  terminal: semanticCompileTerminalSchema,
  proposal_digest: contentHashSchema.nullable(),
  created: z.boolean(),
});
const attachmentResultSchema = z.strictObject({
  candidate_id: immutableIdSchema,
  candidate_revision_id: immutableIdSchema,
  created: z.boolean(),
});
const driftEvidenceSchema = z.strictObject({
  event: schemaDriftEventSchema,
  event_storage_digest: contentHashSchema,
});
const compileBundleSchema = z.strictObject({
  compile_run_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  input_digest: contentHashSchema,
  feature_packet: schemaFeaturePacketSchema,
  agent_receipt: semanticAgentReceiptSchema,
  terminal: compileStateSchema,
  proposal: semanticChangeProposalSchema.nullable(),
  candidate_id: immutableIdSchema.nullable(),
  candidate_revision_id: immutableIdSchema.nullable(),
  failure_code: z.string().min(1).max(128).nullable(),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
});

interface JsonValueRow {
  readonly value: unknown;
}

export interface SemanticCompileBeginInput {
  readonly semantic_domain: string;
  readonly compile_run_id: string;
  readonly source_revision_id: string;
  readonly idempotency_key: string;
  readonly input_digest: `sha256:${string}`;
  readonly feature_packet: SchemaFeaturePacket;
  readonly agent_receipt: SemanticAgentReceipt;
}

export interface SemanticCompileFinishInput {
  readonly semantic_domain: string;
  readonly compile_run_id: string;
  readonly terminal: z.infer<typeof semanticCompileTerminalSchema>;
  readonly proposal: SemanticChangeProposal | null;
  readonly failure_code: string | null;
}

export interface SemanticCompileCandidateAttachmentInput {
  readonly semantic_domain: string;
  readonly compile_run_id: string;
  readonly candidate_id: string;
  readonly candidate_revision_id: string;
}

export type SemanticCompileBeginResult = z.infer<typeof beginResultSchema>;
export type SemanticCompileFinishResult = z.infer<typeof finishResultSchema>;
export type SemanticCompileCandidateAttachment = z.infer<typeof attachmentResultSchema>;
export type SemanticCompileBundle = z.infer<typeof compileBundleSchema>;
export type SemanticCompileDriftEvidence = z.infer<typeof driftEvidenceSchema>;

export interface PostgresSemanticCandidateCompileStore {
  getDriftEvidence(
    capability: unknown,
    semanticDomain: string,
    datasourceId: string,
    driftEventId: string,
  ): Promise<PortResult<SemanticCompileDriftEvidence>>;
  begin(
    capability: unknown,
    input: SemanticCompileBeginInput,
  ): Promise<PortResult<SemanticCompileBeginResult>>;
  finish(
    capability: unknown,
    input: SemanticCompileFinishInput,
  ): Promise<PortResult<SemanticCompileFinishResult>>;
  get(
    capability: unknown,
    semanticDomain: string,
    compileRunId: string,
  ): Promise<PortResult<SemanticCompileBundle>>;
  attachCandidate(
    capability: unknown,
    input: SemanticCompileCandidateAttachmentInput,
  ): Promise<PortResult<SemanticCompileCandidateAttachment>>;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("IDEMPOTENCY_CONFLICT")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_COMPILE_IDEMPOTENCY_CONFLICT",
        message: "幂等键已绑定到不同的语义编译输入或结果。",
        retryable: false,
      },
    };
  }
  if (
    message.includes("BASE_STALE") ||
    message.includes("SNAPSHOT_STALE") ||
    message.includes("DRIFT_STALE")
  ) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_COMPILE_STALE_BASE",
        message: "物理快照、漂移事件或基础语义发布已变化，请重新生成候选。",
        retryable: false,
      },
    };
  }
  if (message.includes("NOT_FOUND")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_COMPILE_NOT_FOUND",
        message: "语义编译运行不存在或不在当前 Authority scope 内。",
        retryable: false,
      },
    };
  }
  if (message.includes("INVALID")) {
    return {
      ok: false,
      error: {
        code: "SEMANTIC_CANDIDATE_COMPILE_INVALID",
        message: "语义编译内容不符合权威持久化契约。",
        retryable: false,
      },
    };
  }
  return null;
}

function resultValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_CANDIDATE_COMPILE_DATABASE_CONTRACT_INVALID",
      "语义编译 RPC 返回了无效行数。",
    );
  }
  return rows[0]?.value;
}

function parseResult<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(
      "SEMANTIC_CANDIDATE_COMPILE_DATABASE_CONTRACT_INVALID",
      "语义编译 RPC 返回了无效契约。",
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

export function createPostgresSemanticCandidateCompileStore(
  options: Readonly<{
    pool: SqlPool;
    authorizer: TransactionalCapabilityAuthorizer;
  }>,
): PostgresSemanticCandidateCompileStore {
  return {
    async getDriftEvidence(
      capabilityInput,
      semanticDomainInput,
      datasourceIdInput,
      driftEventIdInput,
    ) {
      const semanticDomain = semanticDomainSchema.parse(semanticDomainInput);
      const datasourceId = z.string().min(1).max(128).parse(datasourceIdInput);
      const driftEventId = immutableIdSchema.parse(driftEventIdInput);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "semantic.get_schema_candidate_drift_evidence",
          correlation_id: driftEventId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, semanticDomain);
          const query = await client.query<JsonValueRow>(
            `select semantic.get_schema_candidate_drift_evidence(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text, $7::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              datasourceId,
              driftEventId,
            ],
          );
          const value = resultValue(query.rows);
          if (value === null) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CANDIDATE_COMPILE_NOT_FOUND",
              "Schema drift evidence 不存在。",
              false,
            );
          }
          return parseResult(driftEvidenceSchema, value);
        },
      );
    },

    async begin(capabilityInput, input) {
      const semanticDomain = semanticDomainSchema.parse(input.semantic_domain);
      const compileRunId = immutableIdSchema.parse(input.compile_run_id);
      const sourceRevisionId = immutableIdSchema.parse(input.source_revision_id);
      const idempotencyKey = immutableIdSchema.parse(input.idempotency_key);
      const inputDigest = contentHashSchema.parse(input.input_digest);
      const packet = schemaFeaturePacketSchema.parse(input.feature_packet);
      const receipt = semanticAgentReceiptSchema.parse(input.agent_receipt);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic.begin_schema_candidate_compile",
          correlation_id: compileRunId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, semanticDomain);
          const query = await client.query<JsonValueRow>(
            `select semantic.begin_schema_candidate_compile(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::uuid, $8::uuid, $9::text, $10::jsonb, $11::jsonb
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              compileRunId,
              sourceRevisionId,
              idempotencyKey,
              inputDigest,
              packet,
              receipt,
            ],
          );
          return parseResult(beginResultSchema, resultValue(query.rows));
        },
      );
    },

    async finish(capabilityInput, input) {
      const semanticDomain = semanticDomainSchema.parse(input.semantic_domain);
      const compileRunId = immutableIdSchema.parse(input.compile_run_id);
      const terminal = semanticCompileTerminalSchema.parse(input.terminal);
      const proposal =
        input.proposal === null ? null : semanticChangeProposalSchema.parse(input.proposal);
      if (
        (terminal === "COMPILED") !== (proposal !== null) ||
        (terminal === "COMPILED") !== (input.failure_code === null)
      ) {
        return {
          ok: false,
          error: {
            code: "SEMANTIC_CANDIDATE_COMPILE_INVALID",
            message: "COMPILED 必须携带提案且不能携带失败码；其他终态规则相反。",
            retryable: false,
          },
        };
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic.finish_schema_candidate_compile",
          correlation_id: compileRunId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, semanticDomain);
          const query = await client.query<JsonValueRow>(
            `select semantic.finish_schema_candidate_compile(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::text, $8::jsonb, $9::text
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              compileRunId,
              terminal,
              proposal,
              input.failure_code,
            ],
          );
          return parseResult(finishResultSchema, resultValue(query.rows));
        },
      );
    },

    async get(capabilityInput, semanticDomainInput, compileRunIdInput) {
      const semanticDomain = semanticDomainSchema.parse(semanticDomainInput);
      const compileRunId = immutableIdSchema.parse(compileRunIdInput);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
          operation_name: "semantic.get_schema_candidate_compile",
          correlation_id: compileRunId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, semanticDomain);
          const query = await client.query<JsonValueRow>(
            `select semantic.get_schema_candidate_compile(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              compileRunId,
            ],
          );
          const value = resultValue(query.rows);
          if (value === null) {
            throw new PersistenceBoundaryError(
              "SEMANTIC_CANDIDATE_COMPILE_NOT_FOUND",
              "语义编译运行不存在。",
              false,
            );
          }
          return parseResult(compileBundleSchema, value);
        },
      );
    },

    async attachCandidate(capabilityInput, input) {
      const semanticDomain = semanticDomainSchema.parse(input.semantic_domain);
      const compileRunId = immutableIdSchema.parse(input.compile_run_id);
      const candidateId = immutableIdSchema.parse(input.candidate_id);
      const candidateRevisionId = immutableIdSchema.parse(input.candidate_revision_id);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "semantic.attach_schema_compile_candidate",
          correlation_id: compileRunId,
          map_database_error: databaseFailure,
        },
        async ({ capability, client }) => {
          await setSemanticDomain(client, semanticDomain);
          const query = await client.query<JsonValueRow>(
            `select semantic.attach_schema_compile_candidate(
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
               $6::uuid, $7::uuid, $8::uuid
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              compileRunId,
              candidateId,
              candidateRevisionId,
            ],
          );
          return parseResult(attachmentResultSchema, resultValue(query.rows));
        },
      );
    },
  };
}
