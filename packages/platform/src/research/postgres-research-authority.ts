import {
  type AnalysisAuthorityCommit,
  type AnalysisAuthorityCommitReceipt,
  type AnalysisContextJournalAppendCommand,
  type AnalysisContextJournalEntry,
  type AnalysisContextModelCellSourceReadCommand,
  type AnalysisContextModelCellSourceReadResult,
  type AnalysisPythonSourceCommitCommand,
  type AnalysisPythonSourceCommitResult,
  type AnalysisResultStage,
  type AnalysisResultStageCleanupCommand,
  type AnalysisResultStageCleanupReceipt,
  type AnalysisResultStageCommand,
  type AppScope,
  analysisAgentFinalResponseSchema,
  analysisAuthorityCommitReceiptSchema,
  analysisAuthorityCommitSchema,
  analysisContextJournalAppendCommandSchema,
  analysisContextJournalEntrySchema,
  analysisContextModelCellSourceReadCommandSchema,
  analysisContextModelCellSourceReadResultSchema,
  analysisPythonSourceCommitCommandSchema,
  analysisPythonSourceCommitResultSchema,
  analysisResultStageCleanupCommandSchema,
  analysisResultStageCleanupReceiptSchema,
  analysisResultStageCommandSchema,
  analysisResultStageSchema,
  appScopeSchema,
  artifactReferenceSchema,
  type CurrentReadinessPort,
  commitCurrentGoInputSchema,
  commitReportReadResponseInputSchema,
  commitResearchStopTerminalInputSchema,
  committedCurrentGoSchema,
  committedCurrentRevocationSchema,
  committedFrontierSchema,
  committedReportReadResponseSchema,
  committedResearchArtifactSchema,
  committedResearchStopTerminalSchema,
  consumeCurrentInputSchema,
  consumedReportReadGrantSchema,
  consumeReportReadGrantInputSchema,
  createU6DbResultSchema,
  currentReadinessConsumeResultSchema,
  type E1AnalysisPublicationCommand,
  type E1AnalysisPublicationReceipt,
  e1AnalysisPublicationCommandSchema,
  e1AnalysisPublicationReceiptSchema,
  expiredReportReadGrantSchema,
  expireReportReadGrantInputSchema,
  frontierAdvanceInputSchema,
  frontierInitializeInputSchema,
  type GovernedOperatorResultCommit,
  type GovernedOperatorResultRef,
  governedOperatorResultCommitSchema,
  governedOperatorResultRefSchema,
  type HistoricalL2ResearchDocument,
  type HistoricalVersionedL2ResearchDocument,
  immutableIdSchema,
  publishCurrentInputSchema,
  publishedCurrentReadinessSchema,
  type ResearchArtifactAuthorityPort,
  type ResearchStopTerminalPort,
  type ResearchVersionFrontierPort,
  readHistoricalL2ResearchDocument,
  readHistoricalVersionedL2ResearchDocument,
  researchArtifactCommitInputSchema,
  revokeCurrentInputSchema,
  U6_ERROR_RETRYABLE,
  type U6DbResult,
  type U6PlatformError,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type AppTransactionOptions,
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { BoundaryResult } from "../tenancy/capability.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const U6_DB_COMMAND_PROTOCOL_VERSION = "u6-db-command@1.0.0" as const;
const DEFAULT_LOCK_RETRY_DELAYS_MS = Object.freeze([10, 25, 50] as const);
const lockRetryDelaysSchema = z.array(z.number().int().min(0).max(1_000)).max(3);

const capabilityInputSchema = z.strictObject({
  app_capability: z.unknown().refine((value) => value !== undefined),
  authority_capability_id: immutableIdSchema,
});

const historicalReadCommandSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  ref: artifactReferenceSchema,
});

const historicalDocumentSchema = z
  .strictObject({
    authority: z.literal("HISTORICAL_READ_ONLY"),
    can_authorize_current: z.literal(false),
    document: z.unknown(),
  })
  .transform((value, ctx): HistoricalL2ResearchDocument | HistoricalVersionedL2ResearchDocument => {
    try {
      return readHistoricalVersionedL2ResearchDocument(value.document);
    } catch {
      try {
        return readHistoricalL2ResearchDocument(value.document);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message:
            error instanceof Error
              ? `Historical Research Document 无效：${error.message}`
              : "Historical Research Document 无效。",
        });
        return z.NEVER;
      }
    }
  });

const historicalReadResultSchema = z.union([z.null(), historicalDocumentSchema]);

const analysisSystemArtifactTypeSchema = z.enum([
  "AnalysisInputMaterializationReceipt",
  "SandboxExecutionReceipt",
  "SandboxResult",
]);

const analysisSystemArtifactCommandSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(256),
  attempt_id: immutableIdSchema,
  worker_fence: z.number().int().positive(),
  reference: artifactReferenceSchema.extend({ artifact_type: analysisSystemArtifactTypeSchema }),
  payload: z.record(z.string(), z.unknown()),
});

const analysisSystemArtifactResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    created: z.boolean(),
    reference: artifactReferenceSchema.extend({ artifact_type: analysisSystemArtifactTypeSchema }),
  }),
  z.strictObject({
    ok: z.literal(false),
    error_code: z.enum([
      "ANALYSIS_SYSTEM_ARTIFACT_CONTRACT_INVALID",
      "ANALYSIS_SYSTEM_ARTIFACT_CONTENT_HASH_MISMATCH",
      "ANALYSIS_SYSTEM_ARTIFACT_IDEMPOTENCY_CONFLICT",
      "RESEARCH_AUTHORITY_FENCE_MISMATCH",
      "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
      "RESEARCH_DATABASE_AUTHORITY_REQUIRED",
      "RESEARCH_DATABASE_CONTRACT_INVALID",
      "RESEARCH_PERSISTENCE_UNAVAILABLE",
      "RESEARCH_AUTHORITY_LOCK_CONTENDED",
    ]),
  }),
]);

const analysisLifecycleErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/u);
const analysisContextJournalResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), entry: analysisContextJournalEntrySchema }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const governedOperatorResultCommitResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    created: z.boolean(),
    result: governedOperatorResultRefSchema,
    journal_entry: analysisContextJournalEntrySchema,
  }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const analysisResultStageRpcResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    stage: analysisResultStageSchema,
    journal_entry: analysisContextJournalEntrySchema,
  }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const analysisResultStageCleanupRpcResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), receipt: analysisResultStageCleanupReceiptSchema }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const analysisResultStageReadRpcResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    stage_command: analysisResultStageCommandSchema,
    oracle_record: z.nullable(
      z.strictObject({
        receipt_payload: z.record(z.string(), z.unknown()),
        receipt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      }),
    ),
    explanation_record: z.nullable(
      z.strictObject({
        explanation: analysisAgentFinalResponseSchema,
        explanation_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        provider_invocation_ref: z.strictObject({
          resource_id: immutableIdSchema,
          resource_revision: z.literal(1),
          resource_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        }),
      }),
    ),
    artifacts: z
      .array(
        z.strictObject({
          artifact_name: z.string().min(1).max(128),
          artifact_kind: z.enum(["RESULT", "TABLE", "CHART"]),
          media_type: z.literal("application/json"),
          content_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          bytes: z
            .number()
            .int()
            .nonnegative()
            .max(64 * 1024 * 1024),
          content_base64: z.string(),
        }),
      )
      .min(3)
      .max(66),
  }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const analysisStageRecordRpcResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), journal_entry: analysisContextJournalEntrySchema }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const analysisStageRecordIdentitySchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  worker_fence: z.number().int().positive(),
  node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
  context_generation: z.number().int().positive(),
  stage_id: immutableIdSchema,
  stage_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});
const analysisStageOracleRecordCommandSchema = analysisStageRecordIdentitySchema.extend({
  schema_version: z.literal("analysis-stage-oracle-record@1.0.0"),
  receipt_payload: z.record(z.string(), z.unknown()),
  receipt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});
const analysisStageExplanationRecordCommandSchema = analysisStageRecordIdentitySchema.extend({
  schema_version: z.literal("analysis-stage-explanation-record@1.0.0"),
  explanation: analysisAgentFinalResponseSchema,
  explanation_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  provider_invocation_ref: z.strictObject({
    resource_id: immutableIdSchema,
    resource_revision: z.literal(1),
    resource_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  }),
});
const analysisAuthorityCommitRpcResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    receipt: analysisAuthorityCommitReceiptSchema,
    journal_entry: analysisContextJournalEntrySchema,
  }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const e1AnalysisPublicationRpcResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), receipt: e1AnalysisPublicationReceiptSchema }),
  z.strictObject({
    ok: z.literal(false),
    error_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/u),
  }),
]);
const analysisContextJournalReadInputSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
  attempt_id: immutableIdSchema,
  context_generation: z.number().int().positive(),
});
const analysisContextJournalReadResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), entries: z.array(analysisContextJournalEntrySchema) }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);
const governedOperatorResultReadRpcSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), error_code: analysisLifecycleErrorCodeSchema }),
]);

export type AnalysisSystemArtifactCommand = z.infer<typeof analysisSystemArtifactCommandSchema>;
export type AnalysisSystemArtifactResult = z.infer<typeof analysisSystemArtifactResultSchema>;

type ResearchAuthorityPorts = ResearchArtifactAuthorityPort &
  ResearchVersionFrontierPort &
  CurrentReadinessPort &
  ResearchStopTerminalPort & {
    commitAnalysisSystem(
      capabilityInput: unknown,
      command: AnalysisSystemArtifactCommand,
      content: Uint8Array | null,
    ): Promise<AnalysisSystemArtifactResult>;
    appendAnalysisContextJournal(
      capabilityInput: unknown,
      command: AnalysisContextJournalAppendCommand,
    ): Promise<
      | { readonly ok: true; readonly entry: AnalysisContextJournalEntry }
      | { readonly ok: false; readonly error_code: string }
    >;
    commitGovernedOperatorResult(
      capabilityInput: unknown,
      command: GovernedOperatorResultCommit,
      journalCommand: AnalysisContextJournalAppendCommand,
      requestContent: Uint8Array,
      resultContent: Uint8Array,
    ): Promise<
      | {
          readonly ok: true;
          readonly created: boolean;
          readonly result: GovernedOperatorResultRef;
          readonly journal_entry: AnalysisContextJournalEntry;
        }
      | { readonly ok: false; readonly error_code: string }
    >;
    readGovernedOperatorResult(
      capabilityInput: unknown,
      result: GovernedOperatorResultRef,
    ): Promise<
      | {
          readonly ok: true;
          readonly result_content: Uint8Array;
          readonly request_content: Uint8Array;
          readonly receipt_payload: Readonly<Record<string, unknown>>;
        }
      | { readonly ok: false; readonly error_code: string }
    >;
    readAnalysisContextJournal(
      capabilityInput: unknown,
      input: z.infer<typeof analysisContextJournalReadInputSchema>,
    ): Promise<
      | { readonly ok: true; readonly entries: readonly AnalysisContextJournalEntry[] }
      | { readonly ok: false; readonly error_code: string }
    >;
    commitAnalysisPythonSource(
      capabilityInput: unknown,
      command: AnalysisPythonSourceCommitCommand,
      ciphertext: Uint8Array,
    ): Promise<AnalysisPythonSourceCommitResult>;
    readAnalysisContextModelCellSource(
      capabilityInput: unknown,
      command: AnalysisContextModelCellSourceReadCommand,
    ): Promise<AnalysisContextModelCellSourceReadResult>;
    stageAnalysisResult(
      capabilityInput: unknown,
      command: AnalysisResultStageCommand,
      journalCommand: AnalysisContextJournalAppendCommand,
      contents: readonly Uint8Array[],
    ): Promise<
      | {
          readonly ok: true;
          readonly stage: AnalysisResultStage;
          readonly journal_entry: AnalysisContextJournalEntry;
        }
      | { readonly ok: false; readonly error_code: string }
    >;
    sweepExpiredAnalysisResultStages(
      capabilityInput: unknown,
      command: AnalysisResultStageCleanupCommand,
    ): Promise<
      | { readonly ok: true; readonly receipt: AnalysisResultStageCleanupReceipt }
      | { readonly ok: false; readonly error_code: string }
    >;
    readAnalysisResultStage(
      capabilityInput: unknown,
      input: {
        readonly lease: {
          readonly scope: AppScope;
          readonly run_id: string;
          readonly principal_id: string;
          readonly attempt_id: string;
          readonly worker_fence: number;
        };
        readonly node_id: string;
        readonly context_generation: number;
        readonly stage: AnalysisResultStage;
      },
    ): Promise<
      | {
          readonly ok: true;
          readonly stage_command: AnalysisResultStageCommand;
          readonly oracle_record: null | {
            readonly receipt_payload: Readonly<Record<string, unknown>>;
            readonly receipt_hash: `sha256:${string}`;
          };
          readonly explanation_record: null | {
            readonly explanation: z.infer<typeof analysisAgentFinalResponseSchema>;
            readonly explanation_hash: `sha256:${string}`;
            readonly provider_invocation_ref: {
              readonly resource_id: string;
              readonly resource_revision: 1;
              readonly resource_hash: `sha256:${string}`;
            };
          };
          readonly artifacts: readonly {
            readonly artifact_name: string;
            readonly artifact_kind: "RESULT" | "TABLE" | "CHART";
            readonly media_type: "application/json";
            readonly content_sha256: `sha256:${string}`;
            readonly bytes: number;
            readonly content: Uint8Array;
          }[];
        }
      | { readonly ok: false; readonly error_code: string }
    >;
    recordAnalysisStageOracle(
      capabilityInput: unknown,
      command: z.infer<typeof analysisStageOracleRecordCommandSchema>,
      journalCommand: AnalysisContextJournalAppendCommand,
    ): Promise<
      | { readonly ok: true; readonly journal_entry: AnalysisContextJournalEntry }
      | { readonly ok: false; readonly error_code: string }
    >;
    recordAnalysisStageExplanation(
      capabilityInput: unknown,
      command: z.infer<typeof analysisStageExplanationRecordCommandSchema>,
      journalCommand: AnalysisContextJournalAppendCommand,
    ): Promise<
      | { readonly ok: true; readonly journal_entry: AnalysisContextJournalEntry }
      | { readonly ok: false; readonly error_code: string }
    >;
    commitAnalysisAuthority(
      capabilityInput: unknown,
      command: AnalysisAuthorityCommit,
      journalCommand: AnalysisContextJournalAppendCommand,
    ): Promise<
      | {
          readonly ok: true;
          readonly receipt: AnalysisAuthorityCommitReceipt;
          readonly journal_entry: AnalysisContextJournalEntry;
        }
      | { readonly ok: false; readonly error_code: string }
    >;
    commitE1AnalysisPublication(
      capabilityInput: unknown,
      command: E1AnalysisPublicationCommand,
    ): Promise<
      | { readonly ok: true; readonly receipt: E1AnalysisPublicationReceipt }
      | { readonly ok: false; readonly error_code: string }
    >;
  };

type ResearchCommand = {
  readonly scope: AppScope;
  readonly run_id: string;
  readonly principal_id: string;
};

type AccessPolicy =
  | {
      readonly access: "READ";
      readonly allowed_roles: readonly ("OWNER" | "ANALYST" | "VIEWER")[];
    }
  | {
      readonly access: "WRITE";
      readonly allowed_roles: readonly ("OWNER" | "ANALYST")[];
    };

type RpcSpec<TCommand extends ResearchCommand, TResult> = AccessPolicy & {
  readonly function_name:
    | "commit_current_l2_artifact"
    | "commit_current_analysis_artifact"
    | "initialize_research_version_frontier"
    | "advance_research_version_frontier"
    | "commit_research_stop_terminal"
    | "publish_current_report_readiness"
    | "consume_current_ready"
    | "revoke_current_readiness"
    | "consume_report_read_grant"
    | "expire_report_read_grant"
    | "commit_report_read_response"
    | "commit_current_release_go";
  readonly command_schema: z.ZodType<TCommand>;
  readonly result_schema: z.ZodType<TResult>;
};

interface ReadRpcSpec<TResult> {
  readonly function_name: "read_historical_l2_research_artifact";
  readonly access: "READ";
  readonly allowed_roles: readonly ("OWNER" | "ANALYST" | "VIEWER")[];
  readonly result_schema: z.ZodType<TResult>;
}

export interface PostgresResearchAuthorityOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly lock_retry_delays_ms?: readonly number[];
  readonly sleep?: (delayMs: number) => Promise<void>;
}

export type PostgresResearchAuthority = ResearchAuthorityPorts;

class ResearchAuthorityTransportError extends Error {
  override readonly name = "ResearchAuthorityTransportError";
}

interface JsonResultRow {
  readonly result: unknown;
}

interface GovernedResultReadRow extends JsonResultRow {
  readonly result_content: Uint8Array | null;
  readonly request_content: Uint8Array | null;
  readonly receipt_payload: unknown;
}

function sleepWithTimer(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function u6Failure(
  code:
    | "RESEARCH_CAPABILITY_SCOPE_MISMATCH"
    | "RESEARCH_DATABASE_AUTHORITY_REQUIRED"
    | "RESEARCH_DATABASE_CONTRACT_INVALID"
    | "RESEARCH_PERSISTENCE_UNAVAILABLE"
    | "RESEARCH_AUTHORITY_LOCK_CONTENDED",
): U6DbResult<never> {
  return {
    protocol_version: "u6-db-result@1.0.0",
    ok: false,
    error: { code, retryable: U6_ERROR_RETRYABLE[code] } as U6PlatformError,
  };
}

function databaseFailure(error: unknown): BoundaryResult<never> | null {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown; readonly message?: unknown })
      : null;
  const sqlstate = candidate?.code;
  const marker = candidate?.message;
  if (sqlstate === "55P03") {
    return {
      ok: false,
      error: {
        code: "RESEARCH_AUTHORITY_LOCK_CONTENDED",
        message: "Research Authority 锁正在竞争，请使用相同命令重试。",
        retryable: true,
      },
    };
  }
  if (sqlstate === "42501" && marker === "DA_U6_CAPABILITY_REQUIRED") {
    return {
      ok: false,
      error: {
        code: "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
        message: "Research Authority Capability 已失效、撤销或与请求范围不匹配。",
        retryable: false,
      },
    };
  }
  if (sqlstate === "22023" && marker === "DA_U6_DB_COMMAND_INVALID") {
    return {
      ok: false,
      error: {
        code: "RESEARCH_DATABASE_CONTRACT_INVALID",
        message: "Research Authority 数据库命令不符合冻结协议。",
        retryable: false,
      },
    };
  }
  return null;
}

function commandEnvelopeSchema<TCommand extends z.ZodType>(commandSchema: TCommand) {
  return z.strictObject({
    protocol_version: z.literal(U6_DB_COMMAND_PROTOCOL_VERSION),
    authority_capability_id: immutableIdSchema,
    command: commandSchema,
  });
}

function scopeMatches(
  command: ResearchCommand,
  capability: { scope: AppScope; principal: string },
) {
  return (
    command.scope.app_id === capability.scope.app_id &&
    command.scope.tenant_id === capability.scope.tenant_id &&
    command.scope.environment === capability.scope.environment &&
    command.principal_id === capability.principal
  );
}

function boundaryFailureToU6<T>(failure: {
  readonly code: string;
  readonly retryable: boolean;
}): U6DbResult<T> {
  switch (failure.code) {
    case "RESEARCH_AUTHORITY_LOCK_CONTENDED":
      return u6Failure("RESEARCH_AUTHORITY_LOCK_CONTENDED");
    case "RESEARCH_DATABASE_CONTRACT_INVALID":
      return u6Failure("RESEARCH_DATABASE_CONTRACT_INVALID");
    case "PERSISTENCE_DATABASE_AUTHORITY_REQUIRED":
      return u6Failure("RESEARCH_DATABASE_AUTHORITY_REQUIRED");
    case "PERSISTENCE_UNAVAILABLE":
      return u6Failure("RESEARCH_PERSISTENCE_UNAVAILABLE");
    case "PERSISTENCE_SCOPE_REJECTED":
    case "PERSISTENCE_WRITE_DENIED":
    case "APP_OPERATION_DENIED":
    case "APP_OPERATION_FROZEN":
    case "CAPABILITY_EPOCH_STALE":
    case "DEPLOYMENT_REVOKED":
    case "MEMBERSHIP_REVOKED":
    case "MEMBERSHIP_NOT_FOUND":
      return u6Failure("RESEARCH_CAPABILITY_SCOPE_MISMATCH");
    case "PERSISTENCE_TRANSACTION_FAILED":
      throw new ResearchAuthorityTransportError(
        "Research Authority 数据库事务发生未分类故障；已回滚且未生成业务 Result。",
      );
    default:
      return u6Failure("RESEARCH_CAPABILITY_SCOPE_MISMATCH");
  }
}

function invalidContract<T>(): U6DbResult<T> {
  return u6Failure("RESEARCH_DATABASE_CONTRACT_INVALID");
}

export function createPostgresResearchAuthority(
  options: PostgresResearchAuthorityOptions,
): PostgresResearchAuthority {
  const lockRetryDelays = Object.freeze(
    lockRetryDelaysSchema.parse(options.lock_retry_delays_ms ?? DEFAULT_LOCK_RETRY_DELAYS_MS),
  );
  const sleep = options.sleep ?? sleepWithTimer;

  async function withAnalysisLockRetry<T>(
    execute: () => Promise<BoundaryResult<T>>,
  ): Promise<BoundaryResult<T>> {
    for (let attempt = 0; ; attempt += 1) {
      const transaction = await execute();
      if (
        !transaction.ok &&
        transaction.error.code === "RESEARCH_AUTHORITY_LOCK_CONTENDED" &&
        attempt < lockRetryDelays.length
      ) {
        await sleep(lockRetryDelays[attempt] ?? 0);
        continue;
      }
      return transaction;
    }
  }

  async function executePrepared<TCommand extends ResearchCommand, TResult>(
    capabilityInput: unknown,
    commandInput: unknown,
    spec: RpcSpec<TCommand, TResult>,
  ): Promise<U6DbResult<TResult>> {
    const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
    const command = spec.command_schema.safeParse(commandInput);
    if (!capabilityBundle.success || !command.success) return invalidContract();

    const envelope = commandEnvelopeSchema(spec.command_schema).parse({
      protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
      authority_capability_id: capabilityBundle.data.authority_capability_id,
      command: command.data,
    });
    const resultSchema = createU6DbResultSchema(spec.result_schema);

    for (let attempt = 0; ; attempt += 1) {
      const transactionOptions: AppTransactionOptions =
        spec.access === "READ"
          ? {
              access: "READ",
              allowed_roles: spec.allowed_roles,
              map_database_error: databaseFailure,
              operation_name: `research_authority.${spec.function_name}`,
              correlation_id: command.data.run_id,
            }
          : {
              access: "WRITE",
              allowed_roles: spec.allowed_roles,
              map_database_error: databaseFailure,
              operation_name: `research_authority.${spec.function_name}`,
              correlation_id: command.data.run_id,
            };
      const transaction = await withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityBundle.data.app_capability,
        transactionOptions,
        async ({ capability, client }) => {
          if (!scopeMatches(command.data, capability)) {
            throw new PersistenceBoundaryError(
              "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
              "Research Command 与事务内 App Capability Scope/Principal 不一致。",
            );
          }
          const databaseResult = await client.query<JsonResultRow>(
            `select app_data_agent.${spec.function_name}($1::jsonb) as result`,
            [envelope],
          );
          const parsedResult = resultSchema.safeParse(databaseResult.rows[0]?.result);
          if (!parsedResult.success) {
            throw new PersistenceBoundaryError(
              "RESEARCH_DATABASE_CONTRACT_INVALID",
              "Research Authority RPC 返回了不符合冻结协议的 Result。",
            );
          }
          return parsedResult.data as U6DbResult<TResult>;
        },
      );

      if (transaction.ok) return transaction.value;
      if (
        transaction.error.code === "RESEARCH_AUTHORITY_LOCK_CONTENDED" &&
        attempt < lockRetryDelays.length
      ) {
        await sleep(lockRetryDelays[attempt] ?? 0);
        continue;
      }
      return boundaryFailureToU6(transaction.error);
    }
  }

  async function executeHistoricalRead(
    capabilityInput: unknown,
    referenceInput: unknown,
    spec: ReadRpcSpec<HistoricalL2ResearchDocument | HistoricalVersionedL2ResearchDocument | null>,
  ): Promise<
    U6DbResult<HistoricalL2ResearchDocument | HistoricalVersionedL2ResearchDocument | null>
  > {
    const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
    const reference = artifactReferenceSchema.safeParse(referenceInput);
    if (!capabilityBundle.success || !reference.success) return invalidContract();

    const capabilityPreflight = options.authorizer.requireRole(
      capabilityBundle.data.app_capability,
      spec.allowed_roles,
      spec.access,
    );
    if (!capabilityPreflight.ok) return boundaryFailureToU6(capabilityPreflight.error);

    const command = historicalReadCommandSchema.safeParse({
      schema_version: "1.0.0",
      scope: {
        app_id: reference.data.app_id,
        tenant_id: reference.data.tenant_id,
        environment: reference.data.environment,
      },
      run_id: reference.data.run_id,
      principal_id: capabilityPreflight.value.principal,
      ref: reference.data,
    });
    if (!command.success) return invalidContract();

    const envelope = commandEnvelopeSchema(historicalReadCommandSchema).parse({
      protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
      authority_capability_id: capabilityBundle.data.authority_capability_id,
      command: command.data,
    });
    const resultSchema = createU6DbResultSchema(spec.result_schema);

    for (let attempt = 0; ; attempt += 1) {
      const transaction = await withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityBundle.data.app_capability,
        {
          access: spec.access,
          allowed_roles: spec.allowed_roles,
          map_database_error: databaseFailure,
          operation_name: `research_authority.${spec.function_name}`,
          correlation_id: reference.data.run_id,
        },
        async ({ capability, client }) => {
          if (!scopeMatches(command.data, capability)) {
            throw new PersistenceBoundaryError(
              "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
              "Historical Research Ref 与事务内 App Capability Scope/Principal 不一致。",
            );
          }
          const databaseResult = await client.query<JsonResultRow>(
            `select app_data_agent.${spec.function_name}($1::jsonb) as result`,
            [envelope],
          );
          const parsedResult = resultSchema.safeParse(databaseResult.rows[0]?.result);
          if (!parsedResult.success) {
            throw new PersistenceBoundaryError(
              "RESEARCH_DATABASE_CONTRACT_INVALID",
              "Historical Research Resolver 返回了不符合冻结协议的 Result。",
            );
          }
          return parsedResult.data as U6DbResult<
            HistoricalL2ResearchDocument | HistoricalVersionedL2ResearchDocument | null
          >;
        },
      );

      if (transaction.ok) return transaction.value;
      if (
        transaction.error.code === "RESEARCH_AUTHORITY_LOCK_CONTENDED" &&
        attempt < lockRetryDelays.length
      ) {
        await sleep(lockRetryDelays[attempt] ?? 0);
        continue;
      }
      return boundaryFailureToU6(transaction.error);
    }
  }

  const artifactCommitSpec = {
    function_name: "commit_current_l2_artifact",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: researchArtifactCommitInputSchema,
    result_schema: committedResearchArtifactSchema,
  } as const;
  const analysisArtifactCommitSpec = {
    function_name: "commit_current_analysis_artifact",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: researchArtifactCommitInputSchema,
    result_schema: committedResearchArtifactSchema,
  } as const;
  const frontierInitializeSpec = {
    function_name: "initialize_research_version_frontier",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: frontierInitializeInputSchema,
    result_schema: committedFrontierSchema,
  } as const;
  const frontierAdvanceSpec = {
    function_name: "advance_research_version_frontier",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: frontierAdvanceInputSchema,
    result_schema: committedFrontierSchema,
  } as const;
  const stopCommitSpec = {
    function_name: "commit_research_stop_terminal",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: commitResearchStopTerminalInputSchema,
    result_schema: committedResearchStopTerminalSchema,
  } as const;
  const publishSpec = {
    function_name: "publish_current_report_readiness",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: publishCurrentInputSchema,
    result_schema: publishedCurrentReadinessSchema,
  } as const;
  const consumeDomainSpec = {
    function_name: "consume_current_ready",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: consumeCurrentInputSchema,
    result_schema: currentReadinessConsumeResultSchema,
  } as const;
  const consumeReportReadSpec = {
    function_name: "consume_current_ready",
    access: "READ",
    allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
    command_schema: consumeCurrentInputSchema,
    result_schema: currentReadinessConsumeResultSchema,
  } as const;
  const revokeSpec = {
    function_name: "revoke_current_readiness",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: revokeCurrentInputSchema,
    result_schema: committedCurrentRevocationSchema,
  } as const;
  const consumeGrantSpec = {
    function_name: "consume_report_read_grant",
    access: "READ",
    allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
    command_schema: consumeReportReadGrantInputSchema,
    result_schema: consumedReportReadGrantSchema,
  } as const;
  const expireGrantSpec = {
    function_name: "expire_report_read_grant",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: expireReportReadGrantInputSchema,
    result_schema: expiredReportReadGrantSchema,
  } as const;
  const commitResponseSpec = {
    function_name: "commit_report_read_response",
    access: "READ",
    allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
    command_schema: commitReportReadResponseInputSchema,
    result_schema: committedReportReadResponseSchema,
  } as const;
  const commitGoSpec = {
    function_name: "commit_current_release_go",
    access: "WRITE",
    allowed_roles: ["OWNER"],
    command_schema: commitCurrentGoInputSchema,
    result_schema: committedCurrentGoSchema,
  } as const;
  const historicalReadSpec = {
    function_name: "read_historical_l2_research_artifact",
    access: "READ",
    allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
    result_schema: historicalReadResultSchema,
  } as const;

  const authority: PostgresResearchAuthority = {
    commitCurrent(capabilityInput, input) {
      const parsed = researchArtifactCommitInputSchema.safeParse(input);
      const analysisTypes = new Set([
        "DataProfile",
        "AnalysisProgram",
        "DerivedAnalysisEvidence",
        "AnalysisCompletionReceipt",
      ]);
      return executePrepared(
        capabilityInput,
        input,
        parsed.success && analysisTypes.has(parsed.data.candidate.payload.artifact_type)
          ? analysisArtifactCommitSpec
          : artifactCommitSpec,
      );
    },
    readHistorical(capabilityInput, reference) {
      return executeHistoricalRead(capabilityInput, reference, historicalReadSpec);
    },
    initialize(capabilityInput, input) {
      return executePrepared(capabilityInput, input, frontierInitializeSpec);
    },
    advance(capabilityInput, input) {
      return executePrepared(capabilityInput, input, frontierAdvanceSpec);
    },
    commit(capabilityInput, input) {
      return executePrepared(capabilityInput, input, stopCommitSpec);
    },
    publish(capabilityInput, input) {
      return executePrepared(capabilityInput, input, publishSpec);
    },
    consume(capabilityInput, input) {
      const parsed = consumeCurrentInputSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(invalidContract());
      if (parsed.data.purpose === "REPORT_READ") {
        return executePrepared(capabilityInput, parsed.data, consumeReportReadSpec);
      }
      return executePrepared(capabilityInput, parsed.data, consumeDomainSpec);
    },
    revoke(capabilityInput, input) {
      return executePrepared(capabilityInput, input, revokeSpec);
    },
    consumeGrant(capabilityInput, input) {
      return executePrepared(capabilityInput, input, consumeGrantSpec);
    },
    expireGrant(capabilityInput, input) {
      return executePrepared(capabilityInput, input, expireGrantSpec);
    },
    commitResponse(capabilityInput, input) {
      return executePrepared(capabilityInput, input, commitResponseSpec);
    },
    commitGo(capabilityInput, input) {
      return executePrepared(capabilityInput, input, commitGoSpec);
    },
    async commitAnalysisSystem(capabilityInput, commandInput, content) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisSystemArtifactCommandSchema.safeParse(commandInput);
      if (!capabilityBundle.success || !command.success) {
        return { ok: false, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.commit_analysis_system_artifact",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis System Artifact 与事务内 App Capability Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.commit_analysis_system_artifact($1::jsonb, $2::bytea) as result",
              [envelope, content],
            );
            const parsed = analysisSystemArtifactResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis System Artifact RPC 返回了不符合冻结协议的 Result。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok) {
        throw new ResearchAuthorityTransportError(
          "Analysis System Artifact 的事务失败被错误映射为成功。",
        );
      }
      return {
        ok: false,
        error_code: failure.error.code,
      } as AnalysisSystemArtifactResult;
    },
    async appendAnalysisContextJournal(capabilityInput, commandInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisContextJournalAppendCommandSchema.safeParse(commandInput);
      if (!capabilityBundle.success || !command.success) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.append_analysis_context_journal",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Context Journal 与事务内 Capability 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.append_analysis_context_journal($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisContextJournalResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Context Journal RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Journal failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async commitGovernedOperatorResult(
      capabilityInput,
      commandInput,
      journalCommandInput,
      requestContent,
      resultContent,
    ) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = governedOperatorResultCommitSchema.safeParse(commandInput);
      const journal = analysisContextJournalAppendCommandSchema.safeParse(journalCommandInput);
      if (
        !capabilityBundle.success ||
        !command.success ||
        !journal.success ||
        requestContent.byteLength === 0 ||
        requestContent.byteLength > 16 * 1024 * 1024 ||
        resultContent.byteLength === 0 ||
        resultContent.byteLength > 16 * 1024 * 1024 ||
        journal.data.event.event_type !== "OPERATOR_RESULT_COMMITTED" ||
        JSON.stringify(journal.data.event.governed_result) !==
          JSON.stringify(command.data.result) ||
        command.data.principal_id !== journal.data.principal_id
      ) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
        journal_command: journal.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.commit_governed_operator_result",
            correlation_id: command.data.result.run_id,
          },
          async ({ capability, client }) => {
            if (
              !scopeMatches(
                {
                  scope: command.data.result.scope,
                  run_id: command.data.result.run_id,
                  principal_id: command.data.principal_id,
                },
                capability,
              )
            ) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Governed Operator Result 与事务内 Capability 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.commit_governed_operator_result($1::jsonb, $2::bytea, $3::bytea) as result",
              [envelope, requestContent, resultContent],
            );
            const parsed = governedOperatorResultCommitResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Governed Operator Result RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Result failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async readGovernedOperatorResult(capabilityInput, resultInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const result = governedOperatorResultRefSchema.safeParse(resultInput);
      if (!capabilityBundle.success || !result.success) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "READ",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.read_governed_operator_result",
            correlation_id: result.data.run_id,
          },
          async ({ capability, client }) => {
            if (
              result.data.scope.app_id !== capability.scope.app_id ||
              result.data.scope.tenant_id !== capability.scope.tenant_id ||
              result.data.scope.environment !== capability.scope.environment
            ) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Governed Operator Result read 与事务内 Capability 不一致。",
              );
            }
            const envelope = {
              protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
              authority_capability_id: capabilityBundle.data.authority_capability_id,
              command: {
                schema_version: "governed-operator-result-read@1.0.0",
                scope: result.data.scope,
                principal_id: capability.principal,
                result: result.data,
              },
            } as const;
            const databaseResult = await client.query<GovernedResultReadRow>(
              "select result, result_content, request_content, receipt_payload from app_data_agent.read_governed_operator_result($1::jsonb)",
              [envelope],
            );
            const parsed = governedOperatorResultReadRpcSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            const row = databaseResult.rows[0];
            const receiptPayload = z
              .record(z.string(), z.unknown())
              .safeParse(row?.receipt_payload);
            if (
              !parsed.success ||
              (parsed.data.ok &&
                (!(row?.result_content instanceof Uint8Array) ||
                  !(row.request_content instanceof Uint8Array) ||
                  !receiptPayload.success))
            ) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Governed Operator Result read RPC 返回无效。",
              );
            }
            return parsed.data.ok
              ? ({
                  ok: true as const,
                  result_content: row?.result_content as Uint8Array,
                  request_content: row?.request_content as Uint8Array,
                  receipt_payload: receiptPayload.data ?? {},
                } as const)
              : parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Result read failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async readAnalysisContextJournal(capabilityInput, readInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisContextJournalReadInputSchema.safeParse(readInput);
      if (!capabilityBundle.success || !command.success) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "READ",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.read_analysis_context_journal",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (
              command.data.scope.app_id !== capability.scope.app_id ||
              command.data.scope.tenant_id !== capability.scope.tenant_id ||
              command.data.scope.environment !== capability.scope.environment
            ) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Context Journal read 与事务内 Capability 不一致。",
              );
            }
            const envelope = {
              protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
              authority_capability_id: capabilityBundle.data.authority_capability_id,
              command: {
                schema_version: "analysis-context-journal-read@1.0.0",
                ...command.data,
                principal_id: capability.principal,
              },
            } as const;
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.read_analysis_context_journal($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisContextJournalReadResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Context Journal read RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Journal read failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async stageAnalysisResult(capabilityInput, commandInput, journalCommandInput, contents) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisResultStageCommandSchema.safeParse(commandInput);
      const journal = analysisContextJournalAppendCommandSchema.safeParse(journalCommandInput);
      if (
        !capabilityBundle.success ||
        !command.success ||
        !journal.success ||
        contents.length !== command.data.artifacts.length ||
        journal.data.event.event_type !== "PUBLISH_STAGE_CREATED" ||
        journal.data.event.stage_id !== command.data.stage_id ||
        journal.data.event.stage_hash !== command.data.stage_hash
      ) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
        journal_command: journal.data,
      } as const;
      const encodedContents = contents.map((content) => Buffer.from(content).toString("base64"));
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.stage_analysis_result",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Result Stage 与事务内 Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.stage_analysis_result($1::jsonb,$2::jsonb) as result",
              [envelope, JSON.stringify(encodedContents)],
            );
            const parsed = analysisResultStageRpcResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Result Stage RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok) throw new ResearchAuthorityTransportError("Stage failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async sweepExpiredAnalysisResultStages(capabilityInput, commandInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisResultStageCleanupCommandSchema.safeParse(commandInput);
      if (!capabilityBundle.success || !command.success) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.cleanup_expired_analysis_result_stages",
            correlation_id: command.data.cleanup_id,
          },
          async ({ capability, client }) => {
            if (
              command.data.scope.app_id !== capability.scope.app_id ||
              command.data.scope.tenant_id !== capability.scope.tenant_id ||
              command.data.scope.environment !== capability.scope.environment ||
              command.data.principal_id !== capability.principal
            ) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Result Stage cleanup 与事务内 Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.cleanup_expired_analysis_result_stages($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisResultStageCleanupRpcResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Result Stage cleanup RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok) {
        throw new ResearchAuthorityTransportError("Stage cleanup failure mapped to success.");
      }
      return { ok: false as const, error_code: failure.error.code };
    },
    async readAnalysisResultStage(capabilityInput, input) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const scope = appScopeSchema.safeParse(input.lease.scope);
      const stage = analysisResultStageSchema.safeParse(input.stage);
      if (!capabilityBundle.success || !scope.success || !stage.success) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const command = {
        schema_version: "analysis-result-stage-read@1.0.0",
        scope: scope.data,
        run_id: input.lease.run_id,
        principal_id: input.lease.principal_id,
        attempt_id: input.lease.attempt_id,
        worker_fence: input.lease.worker_fence,
        node_id: input.node_id,
        context_generation: input.context_generation,
        stage_id: stage.data.stage_id,
        stage_hash: stage.data.stage_hash,
      } as const;
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "READ",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.read_analysis_result_stage",
            correlation_id: command.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Result Stage read 与事务内 Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.read_analysis_result_stage($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisResultStageReadRpcResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Result Stage read RPC 返回无效。",
              );
            }
            if (!parsed.data.ok) return parsed.data;
            return {
              ok: true as const,
              stage_command: parsed.data.stage_command,
              oracle_record: parsed.data.oracle_record
                ? {
                    receipt_payload: parsed.data.oracle_record.receipt_payload,
                    receipt_hash: parsed.data.oracle_record.receipt_hash as `sha256:${string}`,
                  }
                : null,
              explanation_record: parsed.data.explanation_record
                ? {
                    explanation: parsed.data.explanation_record.explanation,
                    explanation_hash: parsed.data.explanation_record
                      .explanation_hash as `sha256:${string}`,
                    provider_invocation_ref: {
                      ...parsed.data.explanation_record.provider_invocation_ref,
                      resource_hash: parsed.data.explanation_record.provider_invocation_ref
                        .resource_hash as `sha256:${string}`,
                    },
                  }
                : null,
              artifacts: parsed.data.artifacts.map(({ content_base64, ...artifact }) => ({
                ...artifact,
                content_sha256: artifact.content_sha256 as `sha256:${string}`,
                content: Buffer.from(content_base64, "base64"),
              })),
            };
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Stage read failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async recordAnalysisStageOracle(capabilityInput, commandInput, journalCommandInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisStageOracleRecordCommandSchema.safeParse(commandInput);
      const journal = analysisContextJournalAppendCommandSchema.safeParse(journalCommandInput);
      if (
        !capabilityBundle.success ||
        !command.success ||
        !journal.success ||
        journal.data.event.event_type !== "ORACLE_VERIFIED" ||
        journal.data.event.stage_id !== command.data.stage_id ||
        journal.data.event.oracle_receipt_hash !== command.data.receipt_hash
      ) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
        journal_command: journal.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.record_analysis_stage_oracle",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Stage Oracle 与事务内 Capability 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.record_analysis_stage_oracle($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisStageRecordRpcResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Stage Oracle RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Oracle record failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async recordAnalysisStageExplanation(capabilityInput, commandInput, journalCommandInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisStageExplanationRecordCommandSchema.safeParse(commandInput);
      const journal = analysisContextJournalAppendCommandSchema.safeParse(journalCommandInput);
      if (
        !capabilityBundle.success ||
        !command.success ||
        !journal.success ||
        journal.data.event.event_type !== "EXPLANATION_BOUND" ||
        journal.data.event.stage_id !== command.data.stage_id ||
        journal.data.event.explanation_hash !== command.data.explanation_hash
      ) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
        journal_command: journal.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.record_analysis_stage_explanation",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Stage Explanation 与事务内 Capability 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.record_analysis_stage_explanation($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisStageRecordRpcResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Stage Explanation RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Explanation record failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async commitAnalysisAuthority(capabilityInput, commandInput, journalCommandInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisAuthorityCommitSchema.safeParse(commandInput);
      const journal = analysisContextJournalAppendCommandSchema.safeParse(journalCommandInput);
      if (
        !capabilityBundle.success ||
        !command.success ||
        !journal.success ||
        journal.data.event.event_type !== "AUTHORITY_COMMITTED" ||
        journal.data.event.stage_id !== command.data.stage_id ||
        journal.data.event.authority_commit_hash !== command.data.authority_commit_hash
      ) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
        journal_command: journal.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.commit_analysis_authority",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Authority Commit 与事务内 Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.commit_analysis_authority($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisAuthorityCommitRpcResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Authority Commit RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok)
        throw new ResearchAuthorityTransportError("Authority commit failure mapped to success.");
      return { ok: false as const, error_code: failure.error.code };
    },
    async commitE1AnalysisPublication(capabilityInput, commandInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = e1AnalysisPublicationCommandSchema.safeParse(commandInput);
      if (!capabilityBundle.success || !command.success) {
        return { ok: false as const, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.commit_e1_analysis_publication",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "E1 Analysis Publication 与事务内 Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.commit_e1_analysis_publication($1::jsonb) as result",
              [envelope],
            );
            const parsed = e1AnalysisPublicationRpcResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "E1 Analysis Publication RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok) {
        throw new ResearchAuthorityTransportError("E1 publication failure mapped to success.");
      }
      return { ok: false as const, error_code: failure.error.code };
    },
    async commitAnalysisPythonSource(capabilityInput, commandInput, ciphertext) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisPythonSourceCommitCommandSchema.safeParse(commandInput);
      if (!capabilityBundle.success || !command.success || ciphertext.byteLength === 0) {
        return { ok: false, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "WRITE",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.commit_analysis_python_source",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Python Source 与事务内 App Capability Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.commit_analysis_python_source($1::jsonb, $2::bytea) as result",
              [envelope, ciphertext],
            );
            const parsed = analysisPythonSourceCommitResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Python Source RPC 返回了不符合冻结协议的 Result。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok) {
        throw new ResearchAuthorityTransportError(
          "Analysis Python Source 的事务失败被错误映射为成功。",
        );
      }
      return {
        ok: false,
        error_code: failure.error.code,
      } as AnalysisPythonSourceCommitResult;
    },
    async readAnalysisContextModelCellSource(capabilityInput, commandInput) {
      const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
      const command = analysisContextModelCellSourceReadCommandSchema.safeParse(commandInput);
      if (!capabilityBundle.success || !command.success) {
        return { ok: false, error_code: "RESEARCH_DATABASE_CONTRACT_INVALID" };
      }
      const envelope = {
        protocol_version: U6_DB_COMMAND_PROTOCOL_VERSION,
        authority_capability_id: capabilityBundle.data.authority_capability_id,
        command: command.data,
      } as const;
      const transaction = await withAnalysisLockRetry(() =>
        withAppTransaction(
          options.pool,
          options.authorizer,
          capabilityBundle.data.app_capability,
          {
            access: "READ",
            allowed_roles: ["OWNER", "ANALYST"],
            map_database_error: databaseFailure,
            operation_name: "research_authority.read_analysis_context_model_cell_source",
            correlation_id: command.data.run_id,
          },
          async ({ capability, client }) => {
            if (!scopeMatches(command.data, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Analysis Context Model Cell Source 与事务内 Scope/Principal 不一致。",
              );
            }
            const databaseResult = await client.query<JsonResultRow>(
              "select app_data_agent.read_analysis_context_model_cell_source($1::jsonb) as result",
              [envelope],
            );
            const parsed = analysisContextModelCellSourceReadResultSchema.safeParse(
              databaseResult.rows[0]?.result,
            );
            if (!parsed.success) {
              throw new PersistenceBoundaryError(
                "RESEARCH_DATABASE_CONTRACT_INVALID",
                "Analysis Context Model Cell Source RPC 返回无效。",
              );
            }
            return parsed.data;
          },
        ),
      );
      if (transaction.ok) return transaction.value;
      const failure = boundaryFailureToU6<never>(transaction.error);
      if (failure.ok) {
        throw new ResearchAuthorityTransportError(
          "Model Cell Source read failure mapped to success.",
        );
      }
      return { ok: false as const, error_code: failure.error.code };
    },
  };
  return Object.freeze(authority);
}
