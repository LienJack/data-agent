import {
  type AppScope,
  appScopeSchema,
  artifactReferenceSchema,
  contentHashSchema,
  createU6DbResultSchema,
  databaseUtcTimestampSchema,
  idempotencyKeySchema,
  immutableIdSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  U6_ERROR_RETRYABLE,
  type U6DbResult,
  type U6PlatformError,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type AppTransactionOptions,
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

// ──────────────────────────────────────────────────
// 1. Input / Output Zod Schemas for each SQL function
// ──────────────────────────────────────────────────

const DEFAULT_LOCK_RETRY_DELAYS_MS = Object.freeze([10, 25, 50] as const);
const lockRetryDelaysSchema = z.array(z.number().int().min(0).max(1_000)).max(3);

/**
 * Strict command base (5 fields) reused across write RPCs.
 * Matches `strictResearchCommandBaseSchema` from contracts.
 */
const strictCommandBaseSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  idempotency_key: idempotencyKeySchema,
});

/**
 * Step kinds accepted by the SQL `begin_research_step` function.
 * Broader than the TypeScript `beginResearchStepInputSchema.step_kind` enum.
 */
const stepKindSchema = z.enum([
  "PLAN",
  "QUERY",
  "EVIDENCE",
  "CLAIM",
  "ASSESSMENT",
  "COVERAGE",
  "STOP",
  "REPORT",
  "CLARIFICATION",
  "REPLAN",
]);

// ── begin_research_step ──────────────────────────

export const beginResearchStepRawInputSchema = strictCommandBaseSchema.extend({
  step_operation_id: immutableIdSchema,
  budget_epoch: positiveIntSchema,
  logical_step_id: immutableIdSchema,
  parent_logical_step_id: immutableIdSchema.nullable(),
  step_seq: positiveIntSchema,
  step_kind: stepKindSchema,
  step_input_hash: contentHashSchema,
  outbox_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  worker_fence: positiveIntSchema,
});

export type BeginResearchStepRawInput = z.infer<typeof beginResearchStepRawInputSchema>;

export const begunResearchStepResultSchema = z.strictObject({
  step_operation_id: immutableIdSchema,
  budget_event_seq: positiveIntSchema,
  budget_event_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
  created: z.boolean(),
});

export type BegunResearchStepResult = z.infer<typeof begunResearchStepResultSchema>;

// ── issue_input_event_watermark_receipt_internal ──

export const issueInputEventWatermarkReceiptRawInputSchema = strictCommandBaseSchema.extend({
  receipt_id: immutableIdSchema,
  observed_event_seq: nonNegativeIntSchema,
  observed_head_hash: contentHashSchema,
  certificate_input_closure_hash: contentHashSchema,
  certificate_ref: artifactReferenceSchema,
});

export type IssueInputEventWatermarkReceiptRawInput = z.infer<
  typeof issueInputEventWatermarkReceiptRawInputSchema
>;

export const issuedWatermarkReceiptResultSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
  created: z.boolean(),
});

export type IssuedWatermarkReceiptResult = z.infer<typeof issuedWatermarkReceiptResultSchema>;

// ── issue_budget_snapshot_receipt ─────────────────

export const budgetSnapshotInputBindingSchema = z.strictObject({
  canonical_path: z.string(),
  binding_group: z.string(),
  ordinal: nonNegativeIntSchema,
  binding_kind: z.string(),
  strict_ref_json: z.unknown(),
  artifact_id: immutableIdSchema,
  artifact_type: z.string(),
  revision: nonNegativeIntSchema,
  content_hash: contentHashSchema,
  node_id: z.string().nullable(),
  budget_epoch: positiveIntSchema.nullable(),
  budget_event_seq: positiveIntSchema.nullable(),
  event_hash: contentHashSchema.nullable(),
  reservation_id: immutableIdSchema.nullable(),
  reservation_seq: positiveIntSchema.nullable(),
  reservation_state: z.string().nullable(),
  reservation_projection: z.unknown().nullable(),
  reservation_projection_hash: contentHashSchema.nullable(),
});

export type BudgetSnapshotInputBinding = z.infer<typeof budgetSnapshotInputBindingSchema>;

export const issueBudgetSnapshotReceiptRawInputSchema = strictCommandBaseSchema.extend({
  receipt_id: immutableIdSchema,
  snapshot_command_hash: contentHashSchema,
  runtime_limits_version: versionIdentifierSchema,
  runtime_limits_hash: contentHashSchema,
  tenant_policy_version: versionIdentifierSchema,
  tenant_policy_hash: contentHashSchema,
  budget_epoch: positiveIntSchema,
  evaluated_through_reservation_seq: nonNegativeIntSchema,
  evaluated_through_budget_event_seq: nonNegativeIntSchema,
  valid_until: databaseUtcTimestampSchema,
  outstanding_set_hash: contentHashSchema,
  active_count: nonNegativeIntSchema,
  outcome_unknown_count: nonNegativeIntSchema,
  abandoned_count: nonNegativeIntSchema,
  actual_used: z.unknown(),
  unresolved_hold: z.unknown(),
  ledger: z.unknown(),
  research_brief_ref: artifactReferenceSchema,
  input_bindings: z.array(budgetSnapshotInputBindingSchema),
});

export type IssueBudgetSnapshotReceiptRawInput = z.infer<
  typeof issueBudgetSnapshotReceiptRawInputSchema
>;

export const issuedBudgetSnapshotReceiptResultSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
  created: z.boolean(),
});

export type IssuedBudgetSnapshotReceiptResult = z.infer<
  typeof issuedBudgetSnapshotReceiptResultSchema
>;

// ── verify_budget_snapshot_receipt ────────────────

export const verifyBudgetSnapshotReceiptInputSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  receipt_id: immutableIdSchema,
  expected_binding_count: nonNegativeIntSchema.nullable(),
});

export type VerifyBudgetSnapshotReceiptInput = z.infer<
  typeof verifyBudgetSnapshotReceiptInputSchema
>;

export const verifiedBudgetSnapshotReceiptResultSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
  valid_until: databaseUtcTimestampSchema,
  binding_count: nonNegativeIntSchema,
});

export type VerifiedBudgetSnapshotReceiptResult = z.infer<
  typeof verifiedBudgetSnapshotReceiptResultSchema
>;

// ── issue_budget_epoch_advance ────────────────────

export const issueBudgetEpochAdvanceRawInputSchema = strictCommandBaseSchema.extend({
  new_budget_epoch: positiveIntSchema,
});

export type IssueBudgetEpochAdvanceRawInput = z.infer<typeof issueBudgetEpochAdvanceRawInputSchema>;

export const advancedBudgetEpochResultSchema = z.strictObject({
  previous_budget_epoch: positiveIntSchema,
  new_budget_epoch: positiveIntSchema,
  budget_event_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
});

export type AdvancedBudgetEpochResult = z.infer<typeof advancedBudgetEpochResultSchema>;

// ── issue_budget_event ────────────────────────────

export const issueBudgetEventRawInputSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  event_kind: z.string(),
  source_operation_kind: z.string(),
  source_operation_id: immutableIdSchema,
  reservation_id: immutableIdSchema.nullable(),
  logical_step_id: immutableIdSchema.nullable(),
  actual_before: z.unknown(),
  actual_after: z.unknown(),
  hold_before: z.unknown().nullable(),
  hold_after: z.unknown().nullable(),
  uncertainty_before: z.unknown().nullable(),
  uncertainty_after: z.unknown().nullable(),
});

export type IssueBudgetEventRawInput = z.infer<typeof issueBudgetEventRawInputSchema>;

export const issuedBudgetEventResultSchema = z.strictObject({
  budget_epoch: positiveIntSchema,
  budget_event_seq: positiveIntSchema,
  event_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
});

export type IssuedBudgetEventResult = z.infer<typeof issuedBudgetEventResultSchema>;

// ── verify_budget_event_chain ─────────────────────

export const verifyBudgetEventChainInputSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  start_epoch: positiveIntSchema,
  end_epoch: positiveIntSchema,
});

export type VerifyBudgetEventChainInput = z.infer<typeof verifyBudgetEventChainInputSchema>;

export const verifiedBudgetEventChainResultSchema = z.strictObject({
  chain_intact: z.boolean(),
  checked_count: nonNegativeIntSchema,
  last_event_hash: contentHashSchema.nullable(),
});

export type VerifiedBudgetEventChainResult = z.infer<typeof verifiedBudgetEventChainResultSchema>;

// ── grant_issue ──────────────────────────────────

export const grantIssueRawInputSchema = strictCommandBaseSchema.extend({
  grant_id: immutableIdSchema,
  ttl_seconds: positiveIntSchema,
  canonical_response_hash: contentHashSchema,
});

export type GrantIssueRawInput = z.infer<typeof grantIssueRawInputSchema>;

export const issuedGrantResultSchema = z.strictObject({
  grant_id: immutableIdSchema,
  state: z.literal("ISSUED"),
  expires_at: databaseUtcTimestampSchema,
  committed_at: databaseUtcTimestampSchema,
});

export type IssuedGrantResult = z.infer<typeof issuedGrantResultSchema>;

// ── grant_consume ────────────────────────────────

export const grantConsumeInputSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  grant_id: immutableIdSchema,
});

export type GrantConsumeInput = z.infer<typeof grantConsumeInputSchema>;

export const consumedGrantResultSchema = z.strictObject({
  grant_id: immutableIdSchema,
  state: z.literal("CONSUMED"),
  committed_at: databaseUtcTimestampSchema,
});

export type ConsumedGrantResult = z.infer<typeof consumedGrantResultSchema>;

// ── grant_response ───────────────────────────────

export const grantResponseInputSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  grant_id: immutableIdSchema,
});

export type GrantResponseInput = z.infer<typeof grantResponseInputSchema>;

export const respondedGrantResultSchema = z.strictObject({
  grant_id: immutableIdSchema,
  state: z.literal("RESPONDED"),
  committed_at: databaseUtcTimestampSchema,
});

export type RespondedGrantResult = z.infer<typeof respondedGrantResultSchema>;

// ── grant_expire ─────────────────────────────────

export const grantExpireInputSchema = z.strictObject({
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  grant_id: immutableIdSchema,
});

export type GrantExpireInput = z.infer<typeof grantExpireInputSchema>;

export const expiredGrantResultSchema = z.strictObject({
  grant_id: immutableIdSchema,
  state: z.literal("EXPIRED"),
  committed_at: databaseUtcTimestampSchema,
});

export type ExpiredGrantResult = z.infer<typeof expiredGrantResultSchema>;

// ──────────────────────────────────────────────────
// 2. Error handling & transport
// ──────────────────────────────────────────────────

class ResearchResourceTransportError extends Error {
  override readonly name = "ResearchResourceTransportError";
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

function databaseFailure(
  error: unknown,
): { ok: false; error: { code: string; message: string; retryable: boolean } } | null {
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
        message: "Research Resource/Invocation 锁正在竞争，请使用相同命令重试。",
        retryable: true,
      },
    };
  }
  if (sqlstate === "42501" && marker === "DA_U6_CAPABILITY_REQUIRED") {
    return {
      ok: false,
      error: {
        code: "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
        message: "Research Resource/Invocation Capability 已失效、撤销或与请求范围不匹配。",
        retryable: false,
      },
    };
  }
  if (sqlstate === "22023" && marker === "DA_U6_DB_COMMAND_INVALID") {
    return {
      ok: false,
      error: {
        code: "RESEARCH_DATABASE_CONTRACT_INVALID",
        message: "Research Resource/Invocation 数据库命令不符合冻结协议。",
        retryable: false,
      },
    };
  }
  return null;
}

function scopeMatches(
  command: { scope: AppScope; run_id: string; principal_id: string },
  capability: { scope: AppScope; principal: string },
): boolean {
  return (
    command.scope.app_id === capability.scope.app_id &&
    command.scope.tenant_id === capability.scope.tenant_id &&
    command.scope.environment === capability.scope.environment &&
    command.principal_id === capability.principal
  );
}

function boundaryFailureToU6<T>(failure: { code: string; retryable: boolean }): U6DbResult<T> {
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
      throw new ResearchResourceTransportError(
        "Research Resource/Invocation 数据库事务发生未分类故障；已回滚且未生成业务 Result。",
      );
    default:
      return u6Failure("RESEARCH_CAPABILITY_SCOPE_MISMATCH");
  }
}

function invalidContract<T>(): U6DbResult<T> {
  return u6Failure("RESEARCH_DATABASE_CONTRACT_INVALID");
}

// ──────────────────────────────────────────────────
// 3. RpcSpec type for raw-command SQL functions
// ──────────────────────────────────────────────────

type RawFunctionName =
  | "begin_research_step"
  | "issue_input_event_watermark_receipt_internal"
  | "issue_budget_snapshot_receipt"
  | "verify_budget_snapshot_receipt"
  | "issue_budget_epoch_advance"
  | "issue_budget_event"
  | "verify_budget_event_chain"
  | "grant_issue"
  | "grant_consume"
  | "grant_response"
  | "grant_expire";

interface RawRpcSpec<TCommand, TResult> {
  readonly function_name: RawFunctionName;
  readonly access: "READ" | "WRITE";
  readonly allowed_roles: readonly ("OWNER" | "ANALYST" | "VIEWER")[];
  readonly command_schema: z.ZodType<TCommand>;
  readonly result_schema: z.ZodType<TResult>;
}

// ──────────────────────────────────────────────────
// 4. Factory & executePreparedRaw
// ──────────────────────────────────────────────────

export interface PostgresResearchResourceInvocationOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly lock_retry_delays_ms?: readonly number[];
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const capabilityInputSchema = z.strictObject({
  app_capability: z.unknown().refine((value) => value !== undefined),
  authority_capability_id: immutableIdSchema,
});

export interface PostgresResearchResourceInvocation {
  beginResearchStep(
    capabilityInput: unknown,
    input: BeginResearchStepRawInput,
  ): Promise<U6DbResult<BegunResearchStepResult>>;

  issueInputEventWatermarkReceipt(
    capabilityInput: unknown,
    input: IssueInputEventWatermarkReceiptRawInput,
  ): Promise<U6DbResult<IssuedWatermarkReceiptResult>>;

  issueBudgetSnapshotReceipt(
    capabilityInput: unknown,
    input: IssueBudgetSnapshotReceiptRawInput,
  ): Promise<U6DbResult<IssuedBudgetSnapshotReceiptResult>>;

  verifyBudgetSnapshotReceipt(
    capabilityInput: unknown,
    input: VerifyBudgetSnapshotReceiptInput,
  ): Promise<U6DbResult<VerifiedBudgetSnapshotReceiptResult>>;

  issueBudgetEpochAdvance(
    capabilityInput: unknown,
    input: IssueBudgetEpochAdvanceRawInput,
  ): Promise<U6DbResult<AdvancedBudgetEpochResult>>;

  issueBudgetEvent(
    capabilityInput: unknown,
    input: IssueBudgetEventRawInput,
  ): Promise<U6DbResult<IssuedBudgetEventResult>>;

  verifyBudgetEventChain(
    capabilityInput: unknown,
    input: VerifyBudgetEventChainInput,
  ): Promise<U6DbResult<VerifiedBudgetEventChainResult>>;

  grantIssue(
    capabilityInput: unknown,
    input: GrantIssueRawInput,
  ): Promise<U6DbResult<IssuedGrantResult>>;

  grantConsume(
    capabilityInput: unknown,
    input: GrantConsumeInput,
  ): Promise<U6DbResult<ConsumedGrantResult>>;

  grantResponse(
    capabilityInput: unknown,
    input: GrantResponseInput,
  ): Promise<U6DbResult<RespondedGrantResult>>;

  grantExpire(
    capabilityInput: unknown,
    input: GrantExpireInput,
  ): Promise<U6DbResult<ExpiredGrantResult>>;
}

export function createPostgresResearchResourceInvocation(
  options: PostgresResearchResourceInvocationOptions,
): PostgresResearchResourceInvocation {
  const lockRetryDelays = Object.freeze(
    lockRetryDelaysSchema.parse(options.lock_retry_delays_ms ?? DEFAULT_LOCK_RETRY_DELAYS_MS),
  );
  const sleep = options.sleep ?? sleepWithTimer;

  /**
   * Execute a SQL function with a raw command (NOT wrapped in an envelope).
   * The command is sent directly as `$1::jsonb` to the SQL function.
   */
  async function executeRaw<TCommand, TResult>(
    capabilityInput: unknown,
    commandInput: unknown,
    spec: RawRpcSpec<TCommand, TResult>,
  ): Promise<U6DbResult<TResult>> {
    const capabilityBundle = capabilityInputSchema.safeParse(capabilityInput);
    const command = spec.command_schema.safeParse(commandInput);
    if (!capabilityBundle.success || !command.success) return invalidContract();

    const resultSchema = createU6DbResultSchema(spec.result_schema);

    for (let attempt = 0; ; attempt += 1) {
      const transactionOptions: AppTransactionOptions =
        spec.access === "READ"
          ? {
              access: "READ",
              allowed_roles: spec.allowed_roles as readonly ("OWNER" | "ANALYST")[],
              map_database_error: databaseFailure,
              operation_name: `research_resource_invocation.${spec.function_name}`,
              correlation_id: (command.data as { run_id?: string }).run_id ?? "",
            }
          : {
              access: "WRITE",
              allowed_roles: spec.allowed_roles as readonly ("OWNER" | "ANALYST")[],
              map_database_error: databaseFailure,
              operation_name: `research_resource_invocation.${spec.function_name}`,
              correlation_id: (command.data as { run_id?: string }).run_id ?? "",
            };

      const transaction = await withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityBundle.data.app_capability,
        transactionOptions,
        async ({ capability, client }) => {
          // Verify scope matches for commands that carry scope+principal
          if (
            "scope" in (command.data as object) &&
            "run_id" in (command.data as object) &&
            "principal_id" in (command.data as object)
          ) {
            const cmd = command.data as {
              scope: AppScope;
              run_id: string;
              principal_id: string;
            };
            if (!scopeMatches(cmd, capability)) {
              throw new PersistenceBoundaryError(
                "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
                "Research Resource/Invocation 命令与事务内 App Capability Scope/Principal 不一致。",
              );
            }
          }

          // Send raw command directly (no envelope wrapping)
          const databaseResult = await client.query<JsonResultRow>(
            `select app_data_agent.${spec.function_name}($1::jsonb) as result`,
            [command.data],
          );

          const parsedResult = resultSchema.safeParse(databaseResult.rows[0]?.result);
          if (!parsedResult.success) {
            throw new PersistenceBoundaryError(
              "RESEARCH_DATABASE_CONTRACT_INVALID",
              `Research Resource/Invocation RPC ${spec.function_name} 返回了不符合冻结协议的 Result。`,
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

  // ── RPC Specs ─────────────────────────────────

  const beginResearchStepSpec: RawRpcSpec<BeginResearchStepRawInput, BegunResearchStepResult> = {
    function_name: "begin_research_step",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: beginResearchStepRawInputSchema,
    result_schema: begunResearchStepResultSchema,
  };

  const issueInputEventWatermarkReceiptSpec: RawRpcSpec<
    IssueInputEventWatermarkReceiptRawInput,
    IssuedWatermarkReceiptResult
  > = {
    function_name: "issue_input_event_watermark_receipt_internal",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: issueInputEventWatermarkReceiptRawInputSchema,
    result_schema: issuedWatermarkReceiptResultSchema,
  };

  const issueBudgetSnapshotReceiptSpec: RawRpcSpec<
    IssueBudgetSnapshotReceiptRawInput,
    IssuedBudgetSnapshotReceiptResult
  > = {
    function_name: "issue_budget_snapshot_receipt",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: issueBudgetSnapshotReceiptRawInputSchema,
    result_schema: issuedBudgetSnapshotReceiptResultSchema,
  };

  const verifyBudgetSnapshotReceiptSpec: RawRpcSpec<
    VerifyBudgetSnapshotReceiptInput,
    VerifiedBudgetSnapshotReceiptResult
  > = {
    function_name: "verify_budget_snapshot_receipt",
    access: "READ",
    allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
    command_schema: verifyBudgetSnapshotReceiptInputSchema,
    result_schema: verifiedBudgetSnapshotReceiptResultSchema,
  };

  const issueBudgetEpochAdvanceSpec: RawRpcSpec<
    IssueBudgetEpochAdvanceRawInput,
    AdvancedBudgetEpochResult
  > = {
    function_name: "issue_budget_epoch_advance",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: issueBudgetEpochAdvanceRawInputSchema,
    result_schema: advancedBudgetEpochResultSchema,
  };

  const issueBudgetEventSpec: RawRpcSpec<IssueBudgetEventRawInput, IssuedBudgetEventResult> = {
    function_name: "issue_budget_event",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: issueBudgetEventRawInputSchema,
    result_schema: issuedBudgetEventResultSchema,
  };

  const verifyBudgetEventChainSpec: RawRpcSpec<
    VerifyBudgetEventChainInput,
    VerifiedBudgetEventChainResult
  > = {
    function_name: "verify_budget_event_chain",
    access: "READ",
    allowed_roles: ["OWNER", "ANALYST", "VIEWER"],
    command_schema: verifyBudgetEventChainInputSchema,
    result_schema: verifiedBudgetEventChainResultSchema,
  };

  const grantIssueSpec: RawRpcSpec<GrantIssueRawInput, IssuedGrantResult> = {
    function_name: "grant_issue",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: grantIssueRawInputSchema,
    result_schema: issuedGrantResultSchema,
  };

  const grantConsumeSpec: RawRpcSpec<GrantConsumeInput, ConsumedGrantResult> = {
    function_name: "grant_consume",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: grantConsumeInputSchema,
    result_schema: consumedGrantResultSchema,
  };

  const grantResponseSpec: RawRpcSpec<GrantResponseInput, RespondedGrantResult> = {
    function_name: "grant_response",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: grantResponseInputSchema,
    result_schema: respondedGrantResultSchema,
  };

  const grantExpireSpec: RawRpcSpec<GrantExpireInput, ExpiredGrantResult> = {
    function_name: "grant_expire",
    access: "WRITE",
    allowed_roles: ["OWNER", "ANALYST"],
    command_schema: grantExpireInputSchema,
    result_schema: expiredGrantResultSchema,
  };

  // ── Public API ────────────────────────────────

  const adapter: PostgresResearchResourceInvocation = {
    beginResearchStep(capabilityInput, input) {
      return executeRaw(capabilityInput, input, beginResearchStepSpec);
    },

    issueInputEventWatermarkReceipt(capabilityInput, input) {
      return executeRaw(capabilityInput, input, issueInputEventWatermarkReceiptSpec);
    },

    issueBudgetSnapshotReceipt(capabilityInput, input) {
      return executeRaw(capabilityInput, input, issueBudgetSnapshotReceiptSpec);
    },

    verifyBudgetSnapshotReceipt(capabilityInput, input) {
      return executeRaw(capabilityInput, input, verifyBudgetSnapshotReceiptSpec);
    },

    issueBudgetEpochAdvance(capabilityInput, input) {
      return executeRaw(capabilityInput, input, issueBudgetEpochAdvanceSpec);
    },

    issueBudgetEvent(capabilityInput, input) {
      return executeRaw(capabilityInput, input, issueBudgetEventSpec);
    },

    verifyBudgetEventChain(capabilityInput, input) {
      return executeRaw(capabilityInput, input, verifyBudgetEventChainSpec);
    },

    grantIssue(capabilityInput, input) {
      return executeRaw(capabilityInput, input, grantIssueSpec);
    },

    grantConsume(capabilityInput, input) {
      return executeRaw(capabilityInput, input, grantConsumeSpec);
    },

    grantResponse(capabilityInput, input) {
      return executeRaw(capabilityInput, input, grantResponseSpec);
    },

    grantExpire(capabilityInput, input) {
      return executeRaw(capabilityInput, input, grantExpireSpec);
    },
  };

  return Object.freeze(adapter);
}
