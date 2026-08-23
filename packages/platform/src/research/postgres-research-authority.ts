import {
  type AnalysisPythonSourceCommitCommand,
  type AnalysisPythonSourceCommitResult,
  analysisPythonSourceCommitCommandSchema,
  analysisPythonSourceCommitResultSchema,
  type AppScope,
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
  expiredReportReadGrantSchema,
  expireReportReadGrantInputSchema,
  frontierAdvanceInputSchema,
  frontierInitializeInputSchema,
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
  "SandboxProgram",
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
    commitAnalysisPythonSource(
      capabilityInput: unknown,
      command: AnalysisPythonSourceCommitCommand,
      ciphertext: Uint8Array,
    ): Promise<AnalysisPythonSourceCommitResult>;
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
      const transaction = await withAppTransaction(
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
      const transaction = await withAppTransaction(
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
  };
  return Object.freeze(authority);
}
