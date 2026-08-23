import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import {
  AUTHORITY_ROLE_POLICY_VERSION,
  type AuthorityIdentity,
  authorityIdentitySchema,
  computePostgresqlExecutionSettingsHash,
  postgresqlExecutionSettingsSchema,
} from "../artifacts/text2sql-evidence.js";
import { semanticContextText2SqlBindingSchema } from "../artifacts/text2sql-primitives.js";
import {
  appScopeSchema,
  type ContentHash,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  EXECUTABLE_QUERY_LIMITS,
  immutableIdSchema,
  postgresqlOutputAliasSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import type { PortResult } from "../common/primitives.js";

export const SANDBOX_RESULT_LIMITS = EXECUTABLE_QUERY_LIMITS;

export const SANDBOX_RESULT_COLUMN_TYPES = [
  "BOOLEAN",
  "INTEGER",
  "NUMBER",
  "STRING",
  "JSON",
] as const;

export const sandboxResultColumnTypeSchema = z.enum(SANDBOX_RESULT_COLUMN_TYPES);

export const sandboxResultColumnSchema = z.strictObject({
  name: postgresqlOutputAliasSchema,
  type: sandboxResultColumnTypeSchema,
});

const sandboxResultColumnsSchema = z
  .array(sandboxResultColumnSchema)
  .min(1)
  .max(SANDBOX_RESULT_LIMITS.max_columns);
const sandboxResultRowsSchema = z
  .array(z.array(z.json()).max(SANDBOX_RESULT_LIMITS.max_columns))
  .max(SANDBOX_RESULT_LIMITS.max_rows);

const sandboxResultDataObjectSchema = z.strictObject({
  columns: sandboxResultColumnsSchema,
  rows: sandboxResultRowsSchema,
});

type SandboxResultData = z.infer<typeof sandboxResultDataObjectSchema>;
type SandboxResultColumnType = z.infer<typeof sandboxResultColumnTypeSchema>;

function sandboxResultValueMatchesType(
  value: z.infer<ReturnType<typeof z.json>>,
  type: SandboxResultColumnType,
): boolean {
  if (value === null || type === "JSON") {
    return true;
  }
  switch (type) {
    case "BOOLEAN":
      return typeof value === "boolean";
    case "INTEGER":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "NUMBER":
      return typeof value === "number";
    case "STRING":
      return typeof value === "string";
  }
}

function validateSandboxResultData(data: SandboxResultData, ctx: z.RefinementCtx): void {
  const names = data.columns.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox Result 列名必须唯一。",
      path: ["columns"],
    });
  }

  for (const [rowIndex, row] of data.rows.entries()) {
    if (row.length !== data.columns.length) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Result 每一行的宽度必须与 columns 完全一致。",
        path: ["rows", rowIndex],
      });
      continue;
    }
    for (const [columnIndex, value] of row.entries()) {
      const column = data.columns[columnIndex];
      if (column && !sandboxResultValueMatchesType(value, column.type)) {
        ctx.addIssue({
          code: "custom",
          message: "Sandbox Result 单元格必须符合声明的稳定列类型。",
          path: ["rows", rowIndex, columnIndex],
        });
      }
    }
  }
}

const sandboxResultDataSchema =
  sandboxResultDataObjectSchema.superRefine(validateSandboxResultData);

function sandboxResultCanonicalBytes(data: SandboxResultData): number {
  return new TextEncoder().encode(canonicalizeJson(data)).byteLength;
}

export function computeSandboxResultBytes(input: unknown): number {
  const data = sandboxResultDataSchema.parse(input);
  return sandboxResultCanonicalBytes(data);
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export function computeSandboxCanonicalMultisetHash(input: unknown): Promise<ContentHash> {
  const rows = sandboxResultRowsSchema.parse(input);
  const canonicalRows = rows.map((row) => canonicalizeJson(row)).sort(compareUnicodeCodePoints);
  return sha256ContentHash(canonicalRows);
}

export function computeSandboxOrderedResultHash(input: unknown): Promise<ContentHash> {
  return sha256ContentHash(sandboxResultDataSchema.parse(input));
}

export const sandboxResultReferenceSchema = artifactReferenceFor("SandboxResult");

const sandboxResultObjectSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  result_ref: sandboxResultReferenceSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  execution_id: immutableIdSchema,
  columns: sandboxResultColumnsSchema,
  rows: sandboxResultRowsSchema,
  row_count: z.number().int().nonnegative().max(SANDBOX_RESULT_LIMITS.max_rows),
  bytes: z.number().int().nonnegative().max(SANDBOX_RESULT_LIMITS.max_bytes),
  result_hash: contentHashSchema,
});

function sameScopeAndRun(
  reference: ArtifactReference,
  scope: z.infer<typeof appScopeSchema>,
  runId: string,
): boolean {
  return (
    reference.app_id === scope.app_id &&
    reference.tenant_id === scope.tenant_id &&
    reference.environment === scope.environment &&
    reference.run_id === runId
  );
}

function validateSandboxResult(
  result: z.infer<typeof sandboxResultObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  validateSandboxResultData(result, ctx);

  if (!sameScopeAndRun(result.result_ref, result.scope, result.run_id)) {
    ctx.addIssue({
      code: "custom",
      message: "SandboxResult Reference 必须与结果属于同一 App/Tenant/Environment/Run。",
      path: ["result_ref"],
    });
  }
  if (result.row_count !== result.rows.length) {
    ctx.addIssue({
      code: "custom",
      message: "SandboxResult.row_count 必须等于实际二维结果行数。",
      path: ["row_count"],
    });
  }

  const observedBytes = sandboxResultCanonicalBytes({
    columns: result.columns,
    rows: result.rows,
  });
  if (result.bytes !== observedBytes) {
    ctx.addIssue({
      code: "custom",
      message: "SandboxResult.bytes 必须等于 columns/rows 的规范 JSON UTF-8 字节数。",
      path: ["bytes"],
    });
  }
  if (result.result_ref.content_hash !== result.result_hash) {
    ctx.addIssue({
      code: "custom",
      message: "SandboxResult Reference Hash 必须等于 result_hash。",
      path: ["result_ref", "content_hash"],
    });
  }
}

export const sandboxResultSchema = sandboxResultObjectSchema.superRefine(validateSandboxResult);

export type SandboxResult = z.infer<typeof sandboxResultSchema>;

export async function computeSandboxResultHash(input: unknown): Promise<ContentHash> {
  const result = sandboxResultSchema.parse(input);
  const {
    result_hash: _resultHash,
    result_ref: { content_hash: _referenceHash, ...resultReference },
    ...material
  } = result;
  return sha256ContentHash({
    ...material,
    result_ref: resultReference,
  });
}

export class SandboxResultAuthorityError extends Error {
  override readonly name = "SandboxResultAuthorityError";
  readonly code = "SANDBOX_RESULT_NOT_AUTHORITATIVE";
}

declare const authoritativeSandboxResult: unique symbol;
const authorizedSandboxResults = new WeakSet<object>();

export type AuthoritativeSandboxResult = SandboxResult & {
  readonly [authoritativeSandboxResult]: true;
};

const sandboxBudgetSchema = z
  .strictObject({
    timeout_ms: z.number().int().positive().max(300_000),
    lock_timeout_ms: z.number().int().positive().max(300_000),
    max_rows: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_rows),
    max_bytes: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_bytes),
    max_memory_mb: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_memory_mb),
  })
  .superRefine((budget, ctx) => {
    if (budget.lock_timeout_ms >= budget.timeout_ms) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox lock_timeout_ms 必须小于 timeout_ms。",
        path: ["lock_timeout_ms"],
      });
    }
  });

const sqlParameterKeySchema = z.string().regex(/^\$[1-9][0-9]*$/);

export const sandboxSqlParametersSchema = z
  .record(sqlParameterKeySchema, z.json())
  .superRefine((parameters, ctx) => {
    const positions = Object.keys(parameters)
      .map((key) => Number(key.slice(1)))
      .sort((left, right) => left - right);
    if (
      positions.some((position) => !Number.isSafeInteger(position)) ||
      positions.some((position, index) => position !== index + 1)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SQL Parameters 必须使用从 $1 开始连续递增的数字位置。",
      });
    }
  });

export const sandboxOrderedSqlParametersSchema = z.array(z.json());

export function deriveOrderedSandboxSqlParameters(
  input: unknown,
): z.infer<typeof sandboxOrderedSqlParametersSchema> {
  const parameters = sandboxSqlParametersSchema.parse(input);
  return deepFreeze(
    sandboxOrderedSqlParametersSchema.parse(
      Array.from(
        { length: Object.keys(parameters).length },
        (_, index) => parameters[`$${index + 1}`],
      ),
    ),
  );
}

export function computeOrderedSandboxSqlParametersHash(input: unknown): Promise<ContentHash> {
  return sha256ContentHash(deriveOrderedSandboxSqlParameters(input));
}

const sandboxSnapshotBindingObjectSchema = z.strictObject({
  snapshot_token: versionIdentifierSchema.nullable(),
  watermark: versionIdentifierSchema.nullable(),
  replay_state: z.enum(["REPLAYABLE", "LIMITED", "REPLAY_UNAVAILABLE"]),
});

function validateSandboxSnapshotBinding(
  snapshot: z.infer<typeof sandboxSnapshotBindingObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (snapshot.replay_state === "REPLAYABLE" && snapshot.snapshot_token === null) {
    ctx.addIssue({
      code: "custom",
      message: "REPLAYABLE Sandbox Snapshot 必须携带 snapshot_token。",
      path: ["snapshot_token"],
    });
  }
  if (snapshot.replay_state === "LIMITED" && snapshot.watermark === null) {
    ctx.addIssue({
      code: "custom",
      message: "LIMITED Sandbox Snapshot 必须携带 watermark。",
      path: ["watermark"],
    });
  }
  if (
    snapshot.replay_state === "REPLAY_UNAVAILABLE" &&
    (snapshot.snapshot_token !== null || snapshot.watermark !== null)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "REPLAY_UNAVAILABLE Sandbox Snapshot 不能伪报 token 或 watermark。",
      path: ["replay_state"],
    });
  }
}

export const sandboxSnapshotBindingSchema = sandboxSnapshotBindingObjectSchema.superRefine(
  validateSandboxSnapshotBinding,
);

export const sandboxSnapshotRequirementSchema = z.strictObject({
  mode: z.enum(["REQUIRE_REPLAYABLE", "ALLOW_LIMITED", "ALLOW_UNAVAILABLE"]),
});

const sandboxTransactionFactsSchema = z.strictObject({
  transaction_id: immutableIdSchema,
  read_only: z.literal(true),
  isolation_level: z.enum(["REPEATABLE_READ", "READ_COMMITTED"]),
});

export const sandboxAuthorityRevalidationSchema = z.strictObject({
  effective_principal_id: z.string().min(1).max(256),
  policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
  revalidated_at: timestampSchema,
  authority_epoch: z.number().int().nonnegative(),
});

const sandboxRequestBase = {
  schema_version: versionIdentifierSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  execution_id: immutableIdSchema,
  idempotency_key: z.string().min(1).max(256),
  budget: sandboxBudgetSchema,
} as const;

export const sandboxExecutionRequestSchema = z
  .discriminatedUnion("language", [
    z.strictObject({
      ...sandboxRequestBase,
      language: z.literal("sql"),
      payload: z.strictObject({
        dialect: z.literal("postgresql"),
        sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
        execution_permit_ref: artifactReferenceFor("ExecutionPermit"),
        resource_admission_ref: artifactReferenceFor("ResourceAdmissionReceipt"),
        datasource_id: immutableIdSchema,
        settings_hash: contentHashSchema,
        execution_settings: postgresqlExecutionSettingsSchema,
        snapshot_requirement: sandboxSnapshotRequirementSchema,
        parameters: sandboxSqlParametersSchema,
        semantic_context_binding: semanticContextText2SqlBindingSchema.optional(),
      }),
    }),
    z.strictObject({
      ...sandboxRequestBase,
      language: z.literal("python"),
      payload: z.strictObject({
        runtime_profile_version: versionIdentifierSchema,
        program_ref: artifactReferenceFor("SandboxProgram"),
        input_refs: z.array(artifactReferenceSchema).max(64),
      }),
    }),
  ])
  .superRefine((request, ctx) => {
    const references =
      request.language === "sql"
        ? [
            request.payload.sql_artifact_ref,
            request.payload.execution_permit_ref,
            request.payload.resource_admission_ref,
          ]
        : [request.payload.program_ref, ...request.payload.input_refs];
    if (
      references.some((reference) => !sameScopeAndRun(reference, request.scope, request.run_id))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Request 的 Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["payload"],
      });
    }
    if (
      request.language === "sql" &&
      (request.payload.execution_settings.statement_timeout_ms !== request.budget.timeout_ms ||
        request.payload.execution_settings.lock_timeout_ms !== request.budget.lock_timeout_ms)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Request 的 PostgreSQL Timeout 必须与执行预算精确一致。",
        path: ["payload", "execution_settings"],
      });
    }
    if (
      request.language === "sql" &&
      request.payload.semantic_context_binding &&
      (request.payload.semantic_context_binding.scope.app_id !== request.scope.app_id ||
        request.payload.semantic_context_binding.scope.tenant_id !== request.scope.tenant_id ||
        request.payload.semantic_context_binding.scope.environment !== request.scope.environment ||
        request.payload.semantic_context_binding.semantic_release.datasource_id !==
          request.payload.datasource_id ||
        request.payload.semantic_context_binding.schema_snapshot.datasource_id !==
          request.payload.datasource_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Semantic Context binding must match the Sandbox scope and datasource.",
        path: ["payload", "semantic_context_binding"],
      });
    }
  });

export type SandboxExecutionRequest = z.infer<typeof sandboxExecutionRequestSchema>;
export type SqlSandboxExecutionRequest = Extract<
  SandboxExecutionRequest,
  { readonly language: "sql" }
>;

export async function computeSandboxExecutionRequestHash(input: unknown): Promise<ContentHash> {
  return sha256ContentHash(sandboxExecutionRequestSchema.parse(input));
}

const sandboxResourceUsageSchema = z.strictObject({
  elapsed_ms: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  peak_memory_mb: z.number().int().nonnegative(),
});

const sandboxExecutionReceiptBaseShape = {
  schema_version: versionIdentifierSchema,
  receipt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  execution_id: immutableIdSchema,
  idempotency_key: z.string().min(1).max(256),
  input_hash: contentHashSchema,
  execution_hash: contentHashSchema,
  reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  resource_usage: sandboxResourceUsageSchema,
} as const;

export const sandboxExecutionReceiptReferenceSchema =
  artifactReferenceFor("SandboxExecutionReceipt");

const successfulSandboxExecutionReceiptObjectSchema = z.strictObject({
  ...sandboxExecutionReceiptBaseShape,
  language: z.literal("sql"),
  executor: authorityIdentitySchema,
  executor_role: z.literal("SANDBOX_EXECUTION"),
  authority_role_policy_version: z.literal(AUTHORITY_ROLE_POLICY_VERSION),
  receipt_ref: sandboxExecutionReceiptReferenceSchema,
  terminal: z.literal("COMPLETED"),
  reason_code: z.literal("EXECUTION_COMPLETED"),
  started_at: timestampSchema,
  completed_at: timestampSchema,
  result_artifact_ref: sandboxResultReferenceSchema,
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  execution_permit_ref: artifactReferenceFor("ExecutionPermit"),
  resource_admission_ref: artifactReferenceFor("ResourceAdmissionReceipt"),
  datasource_id: immutableIdSchema,
  settings_hash: contentHashSchema,
  execution_settings: postgresqlExecutionSettingsSchema,
  transaction: sandboxTransactionFactsSchema,
  authority_revalidation: sandboxAuthorityRevalidationSchema,
  snapshot_token: versionIdentifierSchema.nullable(),
  watermark: versionIdentifierSchema.nullable(),
  replay_state: z.enum(["REPLAYABLE", "LIMITED", "REPLAY_UNAVAILABLE"]),
});

function validateSuccessfulSandboxExecutionReceipt(
  receipt: z.infer<typeof successfulSandboxExecutionReceiptObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const references = [
    receipt.receipt_ref,
    receipt.result_artifact_ref,
    receipt.sql_artifact_ref,
    receipt.execution_permit_ref,
    receipt.resource_admission_ref,
    receipt.authority_revalidation.policy_receipt_ref,
  ];
  if (
    receipt.receipt_ref.artifact_id !== receipt.receipt_id ||
    references.some((reference) => !sameScopeAndRun(reference, receipt.scope, receipt.run_id))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox Receipt 的所有 Reference 必须完整绑定当前 Scope/Run。",
      path: ["receipt_ref"],
    });
  }
  if (receipt.receipt_ref.content_hash !== receipt.execution_hash) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox Receipt Reference Hash 必须等于 execution_hash。",
      path: ["receipt_ref", "content_hash"],
    });
  }
  const durationMs = Date.parse(receipt.completed_at) - Date.parse(receipt.started_at);
  if (durationMs < 0) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox Receipt.completed_at 不能早于 started_at。",
      path: ["completed_at"],
    });
  }
  if (receipt.resource_usage.elapsed_ms > durationMs) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox Receipt.elapsed_ms 不能大于 started_at 到 completed_at 的时间跨度。",
      path: ["resource_usage", "elapsed_ms"],
    });
  }
  validateSandboxSnapshotBinding(receipt, ctx);
}

export const successfulSandboxExecutionReceiptSchema =
  successfulSandboxExecutionReceiptObjectSchema.superRefine(
    validateSuccessfulSandboxExecutionReceipt,
  );

const failedSandboxExecutionReceiptObjectSchema = z.strictObject({
  ...sandboxExecutionReceiptBaseShape,
  terminal: z.enum(["POLICY_BLOCKED", "FAILED"]),
  started_at: timestampSchema.optional(),
  completed_at: timestampSchema.optional(),
});

export const sandboxExecutionReceiptSchema = z
  .discriminatedUnion("terminal", [
    successfulSandboxExecutionReceiptObjectSchema,
    failedSandboxExecutionReceiptObjectSchema,
  ])
  .superRefine((receipt, ctx) => {
    if (receipt.terminal === "COMPLETED") {
      validateSuccessfulSandboxExecutionReceipt(receipt, ctx);
    } else if (
      receipt.started_at &&
      receipt.completed_at &&
      Date.parse(receipt.completed_at) < Date.parse(receipt.started_at)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Receipt.completed_at 不能早于 started_at。",
        path: ["completed_at"],
      });
    }
  });

export type SandboxExecutionReceipt = z.infer<typeof sandboxExecutionReceiptSchema>;
export type SuccessfulSandboxExecutionReceipt = z.infer<
  typeof successfulSandboxExecutionReceiptSchema
>;

export async function computeSandboxExecutionReceiptHash(input: unknown): Promise<ContentHash> {
  const receipt = successfulSandboxExecutionReceiptSchema.parse(input);
  const {
    execution_hash: _executionHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

export const sandboxExecutionPermitBindingSchema = z.strictObject({
  artifact_type: z.literal("ExecutionPermit"),
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  resource_admission_ref: artifactReferenceFor("ResourceAdmissionReceipt"),
  gate_receipt_refs: z.array(artifactReferenceFor("GateReceipt")).length(5),
  datasource_id: immutableIdSchema,
  schema_version: versionIdentifierSchema,
  settings_hash: contentHashSchema,
  execution_settings: postgresqlExecutionSettingsSchema,
  principal_id: z.string().min(1).max(256),
  policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
  budget: sandboxBudgetSchema,
  issued_at: timestampSchema,
  expires_at: timestampSchema,
});

export const sandboxSqlArtifactBindingSchema = z.strictObject({
  artifact_type: z.literal("SqlArtifact"),
  logical_plan_ref: artifactReferenceFor("LogicalPlan"),
  compiler_version: versionIdentifierSchema,
  ast_hash: contentHashSchema,
  dialect: z.literal("postgresql"),
  sql: z.string().min(1).max(100_000),
  parameters: sandboxSqlParametersSchema,
  query_hash: contentHashSchema,
  semantic_context_binding_hash: contentHashSchema.optional(),
});

async function computeSandboxSqlArtifactQueryHash(
  artifact: z.infer<typeof sandboxSqlArtifactBindingSchema>,
): Promise<ContentHash> {
  return sha256ContentHash({
    dialect: artifact.dialect,
    sql: artifact.sql,
    parameters: artifact.parameters,
  });
}

const sandboxExecutionAuthorityRecordSchema = z.strictObject({
  request: sandboxExecutionRequestSchema,
  started_at: timestampSchema,
  completed_at: timestampSchema,
  result_artifact_ref: sandboxResultReferenceSchema,
  datasource_id: immutableIdSchema,
  schema_version: versionIdentifierSchema,
  settings_hash: contentHashSchema,
  applied_execution_settings: postgresqlExecutionSettingsSchema,
  transaction: sandboxTransactionFactsSchema,
  authority_revalidation: sandboxAuthorityRevalidationSchema,
  snapshot: sandboxSnapshotBindingSchema,
  resource_usage: sandboxResourceUsageSchema,
});

export const SANDBOX_EXECUTION_CLAIM_STATES = [
  "ABSENT",
  "CLAIMED",
  "EXECUTING",
  "CANCEL_REQUESTED",
  "RECOVERY_PENDING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REPLAY_UNAVAILABLE",
] as const;

export const sandboxExecutionClaimStateSchema = z.enum(SANDBOX_EXECUTION_CLAIM_STATES);
export type SandboxExecutionClaimState = z.infer<typeof sandboxExecutionClaimStateSchema>;

export const SANDBOX_EXECUTION_AUTHORITY_DISPOSITIONS = [
  "ACCEPTED",
  "REPLAYED",
  "IN_PROGRESS",
  "IDEMPOTENCY_CONFLICT",
  "CANCEL_ACCEPTED",
  "CANCEL_ALREADY_TERMINAL",
  "OUTCOME_UNKNOWN",
  "REPLAY_UNAVAILABLE",
  "REJECTED",
] as const;

export const sandboxExecutionAuthorityDispositionSchema = z.enum(
  SANDBOX_EXECUTION_AUTHORITY_DISPOSITIONS,
);
export type SandboxExecutionAuthorityDisposition = z.infer<
  typeof sandboxExecutionAuthorityDispositionSchema
>;

export const SANDBOX_EXECUTION_AUTHORITY_REASON_CODES = [
  "SANDBOX_AUTHORITY_REJECTED",
  "SANDBOX_EXECUTION_IN_PROGRESS",
  "SANDBOX_IDEMPOTENCY_CONFLICT",
  "SANDBOX_STALE_EXECUTION_FENCE",
  "SANDBOX_SNAPSHOT_REQUIREMENT_UNSATISFIED",
  "SANDBOX_SNAPSHOT_STRATEGY_UNSUPPORTED",
  "SANDBOX_SNAPSHOT_EXPIRED",
  "SANDBOX_SNAPSHOT_AUTHORITY_BREACH",
  "SANDBOX_SQL_SHAPE_REJECTED",
  "SANDBOX_DANGEROUS_FUNCTION_REJECTED",
  "SANDBOX_PARAMETER_BINDING_REJECTED",
  "SANDBOX_OUTCOME_BINDING_MISMATCH",
  "SANDBOX_COLUMN_LIMIT_EXCEEDED",
  "SANDBOX_ROW_LIMIT_EXCEEDED",
  "SANDBOX_BYTE_LIMIT_EXCEEDED",
  "SANDBOX_MEMORY_LIMIT_EXCEEDED",
  "SANDBOX_UNSUPPORTED_RESULT_TYPE",
  "SANDBOX_STATEMENT_TIMEOUT",
  "SANDBOX_QUERY_FAILED",
  "SANDBOX_CANCELLED",
  "SANDBOX_CANCEL_UNCONFIRMED",
  "SANDBOX_EXECUTION_OUTCOME_UNKNOWN",
  "SANDBOX_REPLAY_UNAVAILABLE",
  "SANDBOX_EXECUTION_COMPLETED",
] as const;

export const sandboxExecutionAuthorityReasonCodeSchema = z.enum(
  SANDBOX_EXECUTION_AUTHORITY_REASON_CODES,
);
export type SandboxExecutionAuthorityReasonCode = z.infer<
  typeof sandboxExecutionAuthorityReasonCodeSchema
>;

const snapshotDescriptorObjectSchema = z.strictObject({
  protocol_version: z.literal("postgresql-snapshot@1.0.0"),
  scope_hash: contentHashSchema,
  run_id: immutableIdSchema,
  execution_id: immutableIdSchema,
  principal_id: z.string().min(1).max(256),
  datasource_id: immutableIdSchema,
  datasource_fingerprint: z.string().min(1).max(1_024),
  schema_version: versionIdentifierSchema,
  strategy: z.enum(["CONTROLLED_REVISION", "NONE"]),
  intent: z.enum(["CREATE", "RESOLVE"]),
  snapshot_token: versionIdentifierSchema.nullable(),
  schema_manifest_hash: contentHashSchema.nullable(),
  data_manifest_hash: contentHashSchema.nullable(),
  fixture_manifest_hash: contentHashSchema.nullable(),
  observed_at: timestampSchema,
  replay_state: z.enum(["REPLAYABLE", "REPLAY_UNAVAILABLE"]),
  descriptor_hash: contentHashSchema,
});

export const snapshotDescriptorSchema = snapshotDescriptorObjectSchema.superRefine(
  (descriptor, ctx) => {
    const manifestHashes = [
      descriptor.schema_manifest_hash,
      descriptor.data_manifest_hash,
      descriptor.fixture_manifest_hash,
    ];
    if (
      descriptor.strategy === "CONTROLLED_REVISION" &&
      (descriptor.replay_state !== "REPLAYABLE" ||
        descriptor.snapshot_token === null ||
        manifestHashes.some((hash) => hash === null))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "CONTROLLED_REVISION 必须携带 Snapshot Token、完整 Manifest 并声明 REPLAYABLE。",
        path: ["strategy"],
      });
    }
    if (
      descriptor.strategy === "NONE" &&
      (descriptor.replay_state !== "REPLAY_UNAVAILABLE" ||
        descriptor.snapshot_token !== null ||
        manifestHashes.some((hash) => hash !== null))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "NONE Snapshot 必须为 REPLAY_UNAVAILABLE，且不能携带 Token 或 Manifest。",
        path: ["strategy"],
      });
    }
  },
);

export type SnapshotDescriptor = z.infer<typeof snapshotDescriptorSchema>;

function canonicalSandboxHashTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("Sandbox Hash Timestamp 必须是可解析的绝对时间。");
  }
  return timestamp.toISOString();
}

export async function computeSnapshotDescriptorHash(input: unknown): Promise<ContentHash> {
  const descriptor = snapshotDescriptorSchema.parse(input);
  const { descriptor_hash: _descriptorHash, ...material } = descriptor;
  return sha256ContentHash({
    ...material,
    observed_at: canonicalSandboxHashTimestamp(material.observed_at),
  });
}

const sandboxExecutionImmutableIdentityObjectSchema = z.strictObject({
  protocol_version: z.literal("sandbox-execution-identity@1.0.0"),
  scope: appScopeSchema,
  scope_hash: contentHashSchema,
  run_id: immutableIdSchema,
  execution_id: immutableIdSchema,
  principal_id: z.string().min(1).max(256),
  idempotency_key: z.string().min(1).max(256),
  input_hash: contentHashSchema,
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  execution_permit_ref: artifactReferenceFor("ExecutionPermit"),
  execution_permit_expires_at: timestampSchema,
  resource_admission_ref: artifactReferenceFor("ResourceAdmissionReceipt"),
  policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
  query_hash: contentHashSchema,
  parameters_hash: contentHashSchema,
  ordered_parameters_hash: contentHashSchema,
  datasource_id: immutableIdSchema,
  schema_version: versionIdentifierSchema,
  settings_hash: contentHashSchema,
  budget: sandboxBudgetSchema,
  snapshot_requirement: sandboxSnapshotRequirementSchema,
});

export const sandboxExecutionImmutableIdentitySchema =
  sandboxExecutionImmutableIdentityObjectSchema.superRefine((identity, ctx) => {
    const references = [
      identity.sql_artifact_ref,
      identity.execution_permit_ref,
      identity.resource_admission_ref,
      identity.policy_receipt_ref,
    ];
    if (
      references.some((reference) => !sameScopeAndRun(reference, identity.scope, identity.run_id))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Execution Identity 的所有 Reference 必须属于同一 Scope/Run。",
        path: ["sql_artifact_ref"],
      });
    }
  });

export type SandboxExecutionImmutableIdentity = z.infer<
  typeof sandboxExecutionImmutableIdentitySchema
>;

const executionGrantObjectSchema = z.strictObject({
  protocol_version: z.literal("sandbox-execution-grant@1.0.0"),
  identity: sandboxExecutionImmutableIdentitySchema,
  attempt_id: immutableIdSchema,
  attempt: z.number().int().positive(),
  fencing_token: z.number().int().positive(),
  lease_id: immutableIdSchema,
  lease_expires_at: timestampSchema,
  cancel_epoch: z.number().int().nonnegative(),
  snapshot_descriptor: snapshotDescriptorSchema,
  fixture_manifest_hash: contentHashSchema.nullable(),
  budget: sandboxBudgetSchema,
  issued_at: timestampSchema,
  grant_hash: contentHashSchema,
});

export const executionGrantSchema = executionGrantObjectSchema.superRefine((grant, ctx) => {
  const descriptor = grant.snapshot_descriptor;
  if (
    descriptor.scope_hash !== grant.identity.scope_hash ||
    descriptor.run_id !== grant.identity.run_id ||
    descriptor.execution_id !== grant.identity.execution_id ||
    descriptor.principal_id !== grant.identity.principal_id ||
    descriptor.datasource_id !== grant.identity.datasource_id ||
    descriptor.schema_version !== grant.identity.schema_version
  ) {
    ctx.addIssue({
      code: "custom",
      message: "ExecutionGrant 的 SnapshotDescriptor 必须精确绑定不可变 Execution Identity。",
      path: ["snapshot_descriptor"],
    });
  }
  if (descriptor.fixture_manifest_hash !== grant.fixture_manifest_hash) {
    ctx.addIssue({
      code: "custom",
      message: "ExecutionGrant 必须逐项回显 SnapshotDescriptor.fixture_manifest_hash。",
      path: ["fixture_manifest_hash"],
    });
  }
  if (!sameJson(grant.budget, grant.identity.budget)) {
    ctx.addIssue({
      code: "custom",
      message: "ExecutionGrant Budget 必须逐字段等于已验证的 Execution Identity Budget。",
      path: ["budget"],
    });
  }
  if (
    Date.parse(grant.lease_expires_at) <= Date.parse(grant.issued_at) ||
    Date.parse(grant.lease_expires_at) > Date.parse(grant.identity.execution_permit_expires_at)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "ExecutionGrant Lease 必须晚于签发时间且不能越过 ExecutionPermit.expires_at。",
      path: ["lease_expires_at"],
    });
  }
});

export type ExecutionGrant = z.infer<typeof executionGrantSchema>;

export async function computeExecutionGrantHash(input: unknown): Promise<ContentHash> {
  const grant = executionGrantSchema.parse(input);
  const { grant_hash: _grantHash, ...material } = grant;
  return sha256ContentHash({
    ...material,
    identity: {
      ...material.identity,
      execution_permit_expires_at: canonicalSandboxHashTimestamp(
        material.identity.execution_permit_expires_at,
      ),
    },
    lease_expires_at: canonicalSandboxHashTimestamp(material.lease_expires_at),
    snapshot_descriptor: {
      ...material.snapshot_descriptor,
      observed_at: canonicalSandboxHashTimestamp(material.snapshot_descriptor.observed_at),
    },
    issued_at: canonicalSandboxHashTimestamp(material.issued_at),
  });
}

export const sandboxExecutionResourceFactsSchema = z.strictObject({
  elapsed_ms: z.number().int().nonnegative(),
  observed_rows: z.number().int().nonnegative(),
  observed_bytes: z.number().int().nonnegative(),
  peak_memory_mb: z.number().int().nonnegative(),
  retained_canonical_bytes: z.number().int().nonnegative(),
  current_batch_estimated_bytes: z.number().int().nonnegative(),
  process_rss_high_water_bytes: z.number().int().nonnegative(),
  cgroup_memory_limit_enforced: z.boolean(),
  partial_output_discarded: z.boolean(),
  cutoff_kind: z.enum(["NONE", "COLUMN", "ROW", "BYTE", "MEMORY", "TIMEOUT"]),
});

export const sandboxExecutionCancelFactsSchema = z
  .strictObject({
    cancel_requested: z.boolean(),
    query_cancel_dispatched: z.boolean(),
    query_cancel_confirmed: z.boolean(),
    cancel_disposition: z.enum([
      "NOT_REQUESTED",
      "QUERY_CANCEL_CONFIRMED",
      "QUERY_CANCEL_UNCONFIRMED",
      "AFTER_DATASOURCE_TERMINAL",
    ]),
    cancel_epoch_at_start: z.number().int().nonnegative(),
    cancel_epoch_observed: z.number().int().nonnegative(),
    cancel_requested_at: timestampSchema.nullable(),
  })
  .superRefine((facts, ctx) => {
    if (facts.cancel_epoch_observed < facts.cancel_epoch_at_start) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome 的 cancel epoch 不得倒退。",
        path: ["cancel_epoch_observed"],
      });
    }
    if (
      (!facts.cancel_requested &&
        (facts.query_cancel_dispatched ||
          facts.query_cancel_confirmed ||
          facts.cancel_disposition !== "NOT_REQUESTED" ||
          facts.cancel_requested_at !== null)) ||
      (facts.cancel_requested &&
        (facts.cancel_requested_at === null || facts.cancel_disposition === "NOT_REQUESTED")) ||
      (facts.query_cancel_confirmed &&
        (!facts.query_cancel_dispatched || facts.cancel_disposition !== "QUERY_CANCEL_CONFIRMED"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome 的取消请求、派发、确认和 disposition 必须一致。",
        path: ["cancel_disposition"],
      });
    }
    if (
      (facts.cancel_disposition === "QUERY_CANCEL_UNCONFIRMED" &&
        (!facts.query_cancel_dispatched || facts.query_cancel_confirmed)) ||
      (facts.cancel_disposition === "AFTER_DATASOURCE_TERMINAL" &&
        (facts.query_cancel_dispatched || facts.query_cancel_confirmed))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome 的 Cancel Disposition 与数据库取消事实不一致。",
        path: ["cancel_disposition"],
      });
    }
  });

export const sandboxExecutionRollbackFactsSchema = z.strictObject({
  rollback_confirmed: z.boolean(),
  datasource_terminal: z.enum(["ROLLED_BACK_CLEAN", "ROLLBACK_UNCONFIRMED"]),
});

export const sandboxExecutionConnectionFactsSchema = z
  .strictObject({
    backend_pid: z.number().int().positive().nullable(),
    transaction_status: z.enum(["IDLE", "IN_TRANSACTION", "IN_ERROR", "UNKNOWN"]),
    connection_reused: z.boolean(),
  })
  .superRefine((facts, ctx) => {
    if (facts.connection_reused && facts.transaction_status !== "IDLE") {
      ctx.addIssue({
        code: "custom",
        message: "只有已回到 IDLE 的 Datasource Connection 才能复用。",
        path: ["connection_reused"],
      });
    }
  });

export const sandboxExecutionManifestFactsSchema = z.strictObject({
  snapshot_descriptor_hash: contentHashSchema,
  schema_manifest_hash: contentHashSchema.nullable(),
  data_manifest_hash: contentHashSchema.nullable(),
  fixture_manifest_hash: contentHashSchema.nullable(),
  manifest_revalidated: z.boolean(),
  revalidated_at: timestampSchema,
});

export const sandboxExecutionCanonicalMultisetFactsSchema = z.strictObject({
  canonical_multiset_hash: contentHashSchema.nullable(),
  ordered_result_hash: contentHashSchema.nullable(),
});

const sandboxExecutionOutcomeBase = {
  protocol_version: z.literal("sandbox-execution-outcome@1.0.0"),
  identity: sandboxExecutionImmutableIdentitySchema,
  grant_hash: contentHashSchema,
  input_hash: contentHashSchema,
  execution_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  execution_fence: z.number().int().positive(),
  lease_id: immutableIdSchema,
  cancel_epoch_at_start: z.number().int().nonnegative(),
  cancel_epoch_observed: z.number().int().nonnegative(),
  sql_artifact_hash: contentHashSchema,
  snapshot_descriptor_hash: contentHashSchema,
  fixture_manifest_hash: contentHashSchema.nullable(),
  started_at: timestampSchema,
  completed_at: timestampSchema,
  resource_facts: sandboxExecutionResourceFactsSchema,
  cancel_facts: sandboxExecutionCancelFactsSchema,
  rollback_facts: sandboxExecutionRollbackFactsSchema,
  connection_facts: sandboxExecutionConnectionFactsSchema,
  transaction: sandboxTransactionFactsSchema,
  applied_execution_settings: postgresqlExecutionSettingsSchema,
  manifest_facts: sandboxExecutionManifestFactsSchema,
  canonical_multiset_facts: sandboxExecutionCanonicalMultisetFactsSchema,
  outcome_checksum: contentHashSchema,
} as const;

const completedSandboxExecutionOutcomeSchema = z.strictObject({
  ...sandboxExecutionOutcomeBase,
  terminal: z.literal("COMPLETED"),
  reason_code: z.literal("SANDBOX_EXECUTION_COMPLETED"),
  result: sandboxResultDataSchema,
});

const failedSandboxExecutionOutcomeSchema = z.strictObject({
  ...sandboxExecutionOutcomeBase,
  terminal: z.literal("FAILED"),
  reason_code: z.enum([
    "SANDBOX_SNAPSHOT_REQUIREMENT_UNSATISFIED",
    "SANDBOX_SNAPSHOT_STRATEGY_UNSUPPORTED",
    "SANDBOX_SNAPSHOT_EXPIRED",
    "SANDBOX_SNAPSHOT_AUTHORITY_BREACH",
    "SANDBOX_SQL_SHAPE_REJECTED",
    "SANDBOX_DANGEROUS_FUNCTION_REJECTED",
    "SANDBOX_PARAMETER_BINDING_REJECTED",
    "SANDBOX_COLUMN_LIMIT_EXCEEDED",
    "SANDBOX_ROW_LIMIT_EXCEEDED",
    "SANDBOX_BYTE_LIMIT_EXCEEDED",
    "SANDBOX_MEMORY_LIMIT_EXCEEDED",
    "SANDBOX_UNSUPPORTED_RESULT_TYPE",
    "SANDBOX_STATEMENT_TIMEOUT",
    "SANDBOX_QUERY_FAILED",
    "SANDBOX_CANCEL_UNCONFIRMED",
  ]),
  result: z.null(),
});

const cancelledSandboxExecutionOutcomeSchema = z.strictObject({
  ...sandboxExecutionOutcomeBase,
  terminal: z.literal("CANCELLED"),
  reason_code: z.literal("SANDBOX_CANCELLED"),
  result: z.null(),
});

const replayUnavailableSandboxExecutionOutcomeSchema = z.strictObject({
  ...sandboxExecutionOutcomeBase,
  terminal: z.literal("REPLAY_UNAVAILABLE"),
  reason_code: z.literal("SANDBOX_REPLAY_UNAVAILABLE"),
  result: z.null(),
});

export const sandboxExecutionOutcomeSchema = z
  .discriminatedUnion("terminal", [
    completedSandboxExecutionOutcomeSchema,
    failedSandboxExecutionOutcomeSchema,
    cancelledSandboxExecutionOutcomeSchema,
    replayUnavailableSandboxExecutionOutcomeSchema,
  ])
  .superRefine((outcome, ctx) => {
    if (
      outcome.cancel_epoch_observed < outcome.cancel_epoch_at_start ||
      outcome.cancel_facts.cancel_epoch_at_start !== outcome.cancel_epoch_at_start ||
      outcome.cancel_facts.cancel_epoch_observed !== outcome.cancel_epoch_observed
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome 顶层与 cancel facts 的 Epoch 必须单调且逐项一致。",
        path: ["cancel_epoch_observed"],
      });
    }
    if (
      outcome.snapshot_descriptor_hash !== outcome.manifest_facts.snapshot_descriptor_hash ||
      outcome.fixture_manifest_hash !== outcome.manifest_facts.fixture_manifest_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome 的 Snapshot/Fixture Manifest Identity 必须逐项一致。",
        path: ["manifest_facts"],
      });
    }
    if (
      outcome.rollback_facts.rollback_confirmed !==
        (outcome.rollback_facts.datasource_terminal === "ROLLED_BACK_CLEAN") ||
      (outcome.connection_facts.connection_reused && !outcome.rollback_facts.rollback_confirmed)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome 的 Rollback 与 Connection 复用事实不一致。",
        path: ["rollback_facts"],
      });
    }
    if (
      outcome.terminal === "COMPLETED" &&
      (outcome.canonical_multiset_facts.canonical_multiset_hash === null ||
        outcome.resource_facts.partial_output_discarded ||
        outcome.resource_facts.cutoff_kind !== "NONE" ||
        !outcome.rollback_facts.rollback_confirmed)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "成功 Sandbox Outcome 必须具有 canonical multiset、完整输出与干净 Rollback。",
        path: ["terminal"],
      });
    }
    if (
      outcome.terminal !== "COMPLETED" &&
      outcome.canonical_multiset_facts.canonical_multiset_hash !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "非成功 Sandbox Outcome 不能携带可提交的 canonical multiset。",
        path: ["canonical_multiset_facts", "canonical_multiset_hash"],
      });
    }
    if (Date.parse(outcome.completed_at) < Date.parse(outcome.started_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome.completed_at 不能早于 started_at。",
        path: ["completed_at"],
      });
    }
    const wallDurationMs = Date.parse(outcome.completed_at) - Date.parse(outcome.started_at);
    const budget = outcome.identity.budget;
    if (
      outcome.resource_facts.elapsed_ms > budget.timeout_ms ||
      wallDurationMs > budget.timeout_ms ||
      outcome.resource_facts.observed_rows > budget.max_rows ||
      outcome.resource_facts.observed_bytes > budget.max_bytes ||
      outcome.resource_facts.peak_memory_mb > budget.max_memory_mb
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Outcome 的时间、行数、字节数与内存事实不能越过已验证 Budget。",
        path: ["resource_facts"],
      });
    }
    if (
      outcome.terminal === "COMPLETED" &&
      (outcome.resource_facts.observed_rows !== outcome.result.rows.length ||
        outcome.resource_facts.observed_bytes !== sandboxResultCanonicalBytes(outcome.result) ||
        outcome.resource_facts.retained_canonical_bytes !== outcome.resource_facts.observed_bytes ||
        outcome.resource_facts.current_batch_estimated_bytes !== 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "成功 Sandbox Outcome 的行数、保留规范字节必须精确等于完整 Result，且不能遗留当前批次估算。",
        path: ["resource_facts"],
      });
    }
  });

export type SandboxExecutionOutcome = z.infer<typeof sandboxExecutionOutcomeSchema>;

export async function computeSandboxExecutionOutcomeChecksum(input: unknown): Promise<ContentHash> {
  const outcome = sandboxExecutionOutcomeSchema.parse(input);
  const { outcome_checksum: _outcomeChecksum, ...material } = outcome;
  return sha256ContentHash({
    ...material,
    identity: {
      ...material.identity,
      execution_permit_expires_at: canonicalSandboxHashTimestamp(
        material.identity.execution_permit_expires_at,
      ),
    },
    started_at: canonicalSandboxHashTimestamp(material.started_at),
    completed_at: canonicalSandboxHashTimestamp(material.completed_at),
    cancel_facts: {
      ...material.cancel_facts,
      cancel_requested_at:
        material.cancel_facts.cancel_requested_at === null
          ? null
          : canonicalSandboxHashTimestamp(material.cancel_facts.cancel_requested_at),
    },
    manifest_facts: {
      ...material.manifest_facts,
      revalidated_at: canonicalSandboxHashTimestamp(material.manifest_facts.revalidated_at),
    },
  });
}

const sandboxExecutionClaimObjectSchema = z.strictObject({
  identity: sandboxExecutionImmutableIdentitySchema,
  state: sandboxExecutionClaimStateSchema,
  attempt_id: immutableIdSchema.nullable(),
  attempt: z.number().int().nonnegative(),
  fencing_token: z.number().int().nonnegative(),
  lease_id: immutableIdSchema.nullable(),
  lease_expires_at: timestampSchema.nullable(),
  cancel_epoch: z.number().int().nonnegative(),
  grant_cancel_epoch: z.number().int().nonnegative(),
  cancel_requested_at: timestampSchema.nullable(),
  recovery_deadline: timestampSchema.nullable(),
  snapshot_descriptor: snapshotDescriptorSchema.nullable(),
  grant_hash: contentHashSchema.nullable(),
  result_ref: sandboxResultReferenceSchema.nullable(),
  receipt_ref: sandboxExecutionReceiptReferenceSchema.nullable(),
  terminal_reason_code: sandboxExecutionAuthorityReasonCodeSchema.nullable(),
  updated_at: timestampSchema,
});

export const sandboxExecutionClaimSchema = sandboxExecutionClaimObjectSchema.superRefine(
  (claim, ctx) => {
    const terminal = ["COMPLETED", "FAILED", "CANCELLED", "REPLAY_UNAVAILABLE"].includes(
      claim.state,
    );
    if (
      claim.cancel_epoch < claim.grant_cancel_epoch ||
      (claim.state === "CANCEL_REQUESTED" && claim.cancel_requested_at === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Claim 的 cancel epoch 与取消时间必须单调且符合状态。",
        path: ["cancel_epoch"],
      });
    }
    if (
      claim.state !== "ABSENT" &&
      (claim.attempt < 1 ||
        claim.fencing_token < 1 ||
        claim.attempt_id === null ||
        claim.snapshot_descriptor === null ||
        claim.grant_hash === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "非 ABSENT Sandbox Claim 必须保存 Attempt/Fence/Snapshot/Grant Identity。",
        path: ["attempt_id"],
      });
    }
    if (
      terminal !== (claim.terminal_reason_code !== null) ||
      (terminal && (claim.lease_id !== null || claim.lease_expires_at !== null))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Claim 终态必须释放 Lease 并保存稳定 Reason Code。",
        path: ["terminal_reason_code"],
      });
    }
    if (
      (claim.state === "COMPLETED" && (claim.result_ref === null || claim.receipt_ref === null)) ||
      (claim.state !== "COMPLETED" && (claim.result_ref !== null || claim.receipt_ref !== null))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "只有 COMPLETED Sandbox Claim 可以携带且必须同时携带 Result/Receipt Reference。",
        path: ["receipt_ref"],
      });
    }
    if (
      claim.result_ref &&
      !sameScopeAndRun(claim.result_ref, claim.identity.scope, claim.identity.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Claim Result Reference 必须属于同一 Scope/Run。",
        path: ["result_ref"],
      });
    }
    if (
      claim.receipt_ref &&
      !sameScopeAndRun(claim.receipt_ref, claim.identity.scope, claim.identity.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Sandbox Claim Receipt Reference 必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
  },
);

export type SandboxExecutionClaim = z.infer<typeof sandboxExecutionClaimSchema>;

const sandboxExecutionAuthorityResultShape = {
  schema_version: z.literal("sandbox-execution-authority-result@1.0.0"),
  disposition: sandboxExecutionAuthorityDispositionSchema,
  reason_code: sandboxExecutionAuthorityReasonCodeSchema,
  claim: sandboxExecutionClaimSchema.nullable(),
  grant: executionGrantSchema.nullable(),
} as const;

function validateSandboxExecutionAuthorityResult(
  result: {
    readonly disposition: SandboxExecutionAuthorityDisposition;
    readonly reason_code: SandboxExecutionAuthorityReasonCode;
    readonly claim: SandboxExecutionClaim | null;
    readonly grant: ExecutionGrant | null;
  },
  ctx: z.RefinementCtx,
): void {
  const exactReasons: Partial<
    Record<SandboxExecutionAuthorityDisposition, SandboxExecutionAuthorityReasonCode>
  > = {
    REPLAYED: "SANDBOX_EXECUTION_COMPLETED",
    IN_PROGRESS: "SANDBOX_EXECUTION_IN_PROGRESS",
    IDEMPOTENCY_CONFLICT: "SANDBOX_IDEMPOTENCY_CONFLICT",
    CANCEL_ACCEPTED: "SANDBOX_CANCELLED",
    OUTCOME_UNKNOWN: "SANDBOX_EXECUTION_OUTCOME_UNKNOWN",
    REPLAY_UNAVAILABLE: "SANDBOX_REPLAY_UNAVAILABLE",
  };
  const expectedReason = exactReasons[result.disposition];
  if (expectedReason && result.reason_code !== expectedReason) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox Authority Disposition 必须使用固定 Reason Code。",
      path: ["reason_code"],
    });
  }
  if (
    (result.disposition === "OUTCOME_UNKNOWN" && result.claim?.state !== "RECOVERY_PENDING") ||
    (result.disposition === "REPLAY_UNAVAILABLE" &&
      !["FAILED", "CANCELLED", "REPLAY_UNAVAILABLE"].includes(result.claim?.state ?? "")) ||
    (result.disposition === "REPLAYED" && result.claim?.state !== "COMPLETED")
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Sandbox API Disposition 必须与持久 Claim State 分离但语义一致。",
      path: ["claim", "state"],
    });
  }
  if (result.disposition !== "ACCEPTED" && result.grant !== null) {
    ctx.addIssue({
      code: "custom",
      message: "只有 ACCEPTED Authority Result 可以签发 ExecutionGrant。",
      path: ["grant"],
    });
  }
}

export const sandboxExecutionPrepareResultSchema = z
  .strictObject(sandboxExecutionAuthorityResultShape)
  .superRefine((result, ctx) => {
    validateSandboxExecutionAuthorityResult(result, ctx);
    if (result.disposition === "ACCEPTED" && (result.grant === null || result.claim === null)) {
      ctx.addIssue({
        code: "custom",
        message: "ACCEPTED prepare 必须返回 Claim 与 ExecutionGrant。",
        path: ["grant"],
      });
    }
    if (result.grant !== null && result.claim !== null) {
      if (
        !sameSandboxExecutionIdentity(result.grant.identity, result.claim.identity) ||
        result.grant.attempt_id !== result.claim.attempt_id ||
        result.grant.attempt !== result.claim.attempt ||
        result.grant.fencing_token !== result.claim.fencing_token ||
        result.grant.lease_id !== result.claim.lease_id ||
        result.grant.cancel_epoch !== result.claim.cancel_epoch
      ) {
        ctx.addIssue({
          code: "custom",
          message: "ExecutionGrant 必须逐字段匹配 Authority Claim。",
          path: ["grant"],
        });
      }
    }
  });

export type SandboxExecutionPrepareResult = z.infer<typeof sandboxExecutionPrepareResultSchema>;

export const sandboxExecutionTransitionResultSchema = z
  .strictObject(sandboxExecutionAuthorityResultShape)
  .superRefine(validateSandboxExecutionAuthorityResult);
export type SandboxExecutionTransitionResult = z.infer<
  typeof sandboxExecutionTransitionResultSchema
>;

export const sandboxExecutionCancelRequestSchema = z.strictObject({
  identity: sandboxExecutionImmutableIdentitySchema,
  expected_cancel_epoch: z.number().int().nonnegative(),
  requested_at: timestampSchema,
});
export type SandboxExecutionCancelRequest = z.infer<typeof sandboxExecutionCancelRequestSchema>;

export const sandboxExecutionRecoveryRequestSchema = z.strictObject({
  identity: sandboxExecutionImmutableIdentitySchema,
  expected_attempt_id: immutableIdSchema,
  expected_fencing_token: z.number().int().positive(),
  requested_at: timestampSchema,
});
export type SandboxExecutionRecoveryRequest = z.infer<typeof sandboxExecutionRecoveryRequestSchema>;

export interface SandboxExecutionAuthorityStore {
  prepareExecution(input: {
    readonly identity: SandboxExecutionImmutableIdentity;
    readonly request: SqlSandboxExecutionRequest;
    readonly permit: z.infer<typeof sandboxExecutionPermitBindingSchema>;
    readonly sql_artifact: z.infer<typeof sandboxSqlArtifactBindingSchema>;
    readonly authority_revalidation: z.infer<typeof sandboxAuthorityRevalidationSchema>;
    readonly snapshot_descriptor: SnapshotDescriptor;
    readonly requested_at: string;
  }): Promise<unknown>;
  finalizeExecution(input: {
    readonly identity: SandboxExecutionImmutableIdentity;
    readonly outcome: SandboxExecutionOutcome;
  }): Promise<unknown>;
  failExecution(input: {
    readonly identity: SandboxExecutionImmutableIdentity;
    readonly outcome: SandboxExecutionOutcome;
  }): Promise<unknown>;
  cancelExecution(input: SandboxExecutionCancelRequest): Promise<unknown>;
  recoverExecution(input: SandboxExecutionRecoveryRequest): Promise<unknown>;
  resolveExecutionClaim(identity: SandboxExecutionImmutableIdentity): Promise<unknown | null>;
}

export interface SandboxSnapshotDescriptorResolutionRequest {
  readonly identity: SandboxExecutionImmutableIdentity;
  readonly request: SqlSandboxExecutionRequest;
  readonly permit: z.infer<typeof sandboxExecutionPermitBindingSchema>;
  readonly sql_artifact: z.infer<typeof sandboxSqlArtifactBindingSchema>;
  readonly authority_revalidation: z.infer<typeof sandboxAuthorityRevalidationSchema>;
  readonly requested_at: string;
}

export interface SandboxAuthorityRevalidationRequest {
  readonly execution_permit_ref: ArtifactReference;
  readonly effective_principal_id: string;
  readonly policy_receipt_ref: ArtifactReference;
  readonly transaction_started_at: string;
}

export interface SandboxAuthorityFenceRequest {
  readonly execution_permit_ref: ArtifactReference;
  readonly authority_epoch: number;
  readonly transaction_started_at: string;
}

export interface SandboxExecutionIdempotencyClaim {
  readonly scope: z.infer<typeof appScopeSchema>;
  readonly principal_id: string;
  readonly idempotency_key: string;
  readonly input_hash: ContentHash;
}

export type SandboxExecutionIdempotencyResolution<T> =
  | Readonly<{
      status: "EXECUTED" | "REPLAYED";
      value: T;
    }>
  | Readonly<{
      status: "CONFLICT";
      existing_input_hash: ContentHash;
    }>;

export interface SandboxServerAuthorityRegistration {
  readonly identity: AuthorityIdentity;
  /**
   * U5 三段式 Authority Store。它只负责 Authority PostgreSQL 的本地原子状态转换；
   * Datasource Operation 在 prepare 与 finalize/fail 之间独立执行。
   */
  readonly executionAuthority?: SandboxExecutionAuthorityStore;
  /**
   * 从服务端专用 Snapshot Authority 精确解析当前执行 Descriptor。
   *
   * 普通 Request/Payload 不能自报 Snapshot；prepare 会重新解析 Hash 与完整 Identity。
   */
  resolveSnapshotDescriptor?(
    input: SandboxSnapshotDescriptorResolutionRequest,
  ): Promise<unknown | null>;
  resolveCommitted(reference: ArtifactReference): Promise<unknown | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolveAuthoritativeExecutionPermit(reference: ArtifactReference): Promise<unknown | null>;
  resolveAuthoritativeSqlArtifact(reference: ArtifactReference): Promise<unknown | null>;
  /**
   * 在当前数据库事务中证明 resolver 返回的 payload 就是 Reference 指向的已提交 Revision。
   *
   * `verifyCommitted(reference)` 只能证明 A 存在，不能防止错误缓存为 A 返回内容 B。
   * 真实适配器应以同一行锁/事务快照比较完整规范载荷或数据库保存的内容 Hash。
   */
  verifyExactArtifactRevision(reference: ArtifactReference, artifact: unknown): Promise<boolean>;
  revalidateExecutionAuthority(input: SandboxAuthorityRevalidationRequest): Promise<unknown | null>;
  assertAuthorityFence(input: SandboxAuthorityFenceRequest): Promise<boolean>;
  withSqlTransaction<T>(operation: () => Promise<T>): Promise<T>;
  /**
   * 在当前 SQL 事务中，以 `(scope, principal_id, idempotency_key)` 为唯一键原子
   * Claim/Load。`principal_id` 必须来自服务端解析的 Permit，不能由 Request 自报。
   *
   * 同键同 `input_hash` 必须只运行一次 `operation`，并重放已保存结果；同键异 Hash
   * 必须在调用 `operation` 前返回 CONFLICT。真实执行、Claim 与完成记录必须共享
   * `withSqlTransaction` 打开的同一数据库事务。
   */
  claimOrLoadExecution<T>(
    claim: SandboxExecutionIdempotencyClaim,
    operation: () => Promise<T>,
  ): Promise<SandboxExecutionIdempotencyResolution<T>>;
  resolveExecutionRecord(inputHash: ContentHash): Promise<unknown | null>;
  now(): Date;
}

declare const sandboxServerAuthorityBrand: unique symbol;
export type SandboxServerAuthority = Readonly<{
  readonly [sandboxServerAuthorityBrand]: true;
}>;

const registeredSandboxAuthorities = new WeakMap<object, SandboxServerAuthorityRegistration>();

declare const authoritativeSandboxExecutionIdentityBrand: unique symbol;

export type AuthoritativeSandboxExecutionIdentity = Readonly<{
  identity: AuthorityIdentity;
  role: "SANDBOX_EXECUTION";
  authority_role_policy_version: typeof AUTHORITY_ROLE_POLICY_VERSION;
  readonly [authoritativeSandboxExecutionIdentityBrand]: true;
}>;

const authoritativeSandboxExecutionIdentities = new WeakSet<object>();
const registeredSandboxAuthorityIdentities = new WeakMap<
  object,
  AuthoritativeSandboxExecutionIdentity
>();
const authorizedSandboxValueIdentities = new WeakMap<
  object,
  AuthoritativeSandboxExecutionIdentity
>();

/**
 * 仅供包内服务端适配器注册持久化与执行事实 Authority。
 *
 * 此入口刻意不从 ports/index 或 package root 导出。公开调用者无法用结构相同的
 * callback 自签 WeakSet 品牌；复制 token 也不会继承 WeakMap 中的注册身份。
 */
export function registerSandboxServerAuthority(
  registration: SandboxServerAuthorityRegistration,
): SandboxServerAuthority {
  const identity = authorityIdentitySchema.parse(registration.identity);
  const callbacks = [
    registration.resolveCommitted,
    registration.verifyCommitted,
    registration.resolveAuthoritativeExecutionPermit,
    registration.resolveAuthoritativeSqlArtifact,
    registration.verifyExactArtifactRevision,
    registration.revalidateExecutionAuthority,
    registration.assertAuthorityFence,
    registration.withSqlTransaction,
    registration.claimOrLoadExecution,
    registration.resolveExecutionRecord,
    registration.now,
  ];
  if (callbacks.some((callback) => typeof callback !== "function")) {
    throw new TypeError("Sandbox Server Authority 必须提供完整的服务端校验回调。");
  }
  if (
    registration.executionAuthority &&
    [
      registration.executionAuthority.prepareExecution,
      registration.executionAuthority.finalizeExecution,
      registration.executionAuthority.failExecution,
      registration.executionAuthority.cancelExecution,
      registration.executionAuthority.recoverExecution,
      registration.executionAuthority.resolveExecutionClaim,
    ].some((callback) => typeof callback !== "function")
  ) {
    throw new TypeError("Sandbox 三段式 Execution Authority Store 必须提供完整状态转换回调。");
  }
  if (
    registration.resolveSnapshotDescriptor !== undefined &&
    typeof registration.resolveSnapshotDescriptor !== "function"
  ) {
    throw new TypeError("Sandbox Snapshot Descriptor Resolver 必须是服务端函数。");
  }
  const authority = Object.freeze(Object.create(null)) as SandboxServerAuthority;
  const authoritativeIdentity = deepFreeze({
    identity,
    role: "SANDBOX_EXECUTION" as const,
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
  }) as AuthoritativeSandboxExecutionIdentity;
  authoritativeSandboxExecutionIdentities.add(authoritativeIdentity);
  registeredSandboxAuthorities.set(
    authority,
    Object.freeze({
      ...registration,
      identity,
    }),
  );
  registeredSandboxAuthorityIdentities.set(authority, authoritativeIdentity);
  return authority;
}

function resolveRegisteredSandboxAuthority(
  authority: SandboxServerAuthority,
): SandboxServerAuthorityRegistration {
  const registration =
    typeof authority === "object" && authority !== null
      ? registeredSandboxAuthorities.get(authority)
      : undefined;
  if (!registration) {
    throw new SandboxResultAuthorityError(
      "Sandbox Authority 未经包内服务端注册，结构型 callback 或复制 token 不能授权。",
    );
  }
  return registration;
}

function resolveRegisteredSandboxAuthorityIdentity(
  authority: SandboxServerAuthority,
): AuthoritativeSandboxExecutionIdentity {
  const identity =
    typeof authority === "object" && authority !== null
      ? registeredSandboxAuthorityIdentities.get(authority)
      : undefined;
  if (!identity) {
    throw new SandboxResultAuthorityError("Sandbox Authority 缺少已注册的稳定执行 Identity。");
  }
  return identity;
}

export function isAuthoritativeSandboxExecutionIdentity(
  value: unknown,
): value is AuthoritativeSandboxExecutionIdentity {
  return (
    typeof value === "object" &&
    value !== null &&
    authoritativeSandboxExecutionIdentities.has(value)
  );
}

export function getAuthoritativeSandboxExecutionIdentity(
  value: AuthoritativeSandboxExecutionReceipt | AuthoritativeSandboxResult,
): AuthoritativeSandboxExecutionIdentity | null {
  return typeof value === "object" && value !== null
    ? (authorizedSandboxValueIdentities.get(value) ?? null)
    : null;
}

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sameSandboxExecutionIdentity(
  left: SandboxExecutionImmutableIdentity,
  right: SandboxExecutionImmutableIdentity,
): boolean {
  return sameJson(
    {
      ...left,
      execution_permit_expires_at: canonicalSandboxHashTimestamp(left.execution_permit_expires_at),
    },
    {
      ...right,
      execution_permit_expires_at: canonicalSandboxHashTimestamp(right.execution_permit_expires_at),
    },
  );
}

export class SandboxExecutionAuthorityError extends Error {
  override readonly name = "SandboxExecutionAuthorityError";

  constructor(
    message: string,
    readonly code: SandboxExecutionAuthorityReasonCode = "SANDBOX_AUTHORITY_REJECTED",
  ) {
    super(message);
  }
}

function resolveExecutionAuthorityStore(
  authority: SandboxServerAuthority,
): SandboxExecutionAuthorityStore {
  const store = resolveRegisteredSandboxAuthority(authority).executionAuthority;
  if (!store) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Authority 未注册 U5 三段式 Execution Authority Store。",
    );
  }
  return store;
}

async function buildSandboxExecutionIdentity(
  request: SqlSandboxExecutionRequest,
  permit: z.infer<typeof sandboxExecutionPermitBindingSchema>,
  sqlArtifact: z.infer<typeof sandboxSqlArtifactBindingSchema>,
): Promise<SandboxExecutionImmutableIdentity> {
  return sandboxExecutionImmutableIdentitySchema.parse({
    protocol_version: "sandbox-execution-identity@1.0.0",
    scope: request.scope,
    scope_hash: await sha256ContentHash(request.scope),
    run_id: request.run_id,
    execution_id: request.execution_id,
    principal_id: permit.principal_id,
    idempotency_key: request.idempotency_key,
    input_hash: await computeSandboxExecutionRequestHash(request),
    sql_artifact_ref: request.payload.sql_artifact_ref,
    execution_permit_ref: request.payload.execution_permit_ref,
    execution_permit_expires_at: permit.expires_at,
    resource_admission_ref: request.payload.resource_admission_ref,
    policy_receipt_ref: permit.policy_receipt_ref,
    query_hash: sqlArtifact.query_hash,
    parameters_hash: await sha256ContentHash(request.payload.parameters),
    ordered_parameters_hash: await computeOrderedSandboxSqlParametersHash(
      request.payload.parameters,
    ),
    datasource_id: request.payload.datasource_id,
    schema_version: request.schema_version,
    settings_hash: request.payload.settings_hash,
    budget: request.budget,
    snapshot_requirement: request.payload.snapshot_requirement,
  });
}

async function validateExecutionGrant(grant: ExecutionGrant): Promise<void> {
  if (
    (await sha256ContentHash(grant.identity.scope)) !== grant.identity.scope_hash ||
    (await computeSnapshotDescriptorHash(grant.snapshot_descriptor)) !==
      grant.snapshot_descriptor.descriptor_hash ||
    (await computeExecutionGrantHash(grant)) !== grant.grant_hash
  ) {
    throw new SandboxExecutionAuthorityError(
      "ExecutionGrant 的 Snapshot Descriptor 或 Grant Hash 与规范内容不匹配。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
}

async function resolveSnapshotDescriptorForPreparation(
  registration: SandboxServerAuthorityRegistration,
  context: SandboxSnapshotDescriptorResolutionRequest,
): Promise<SnapshotDescriptor> {
  if (!registration.resolveSnapshotDescriptor) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox prepare 缺少服务端专用 Snapshot Descriptor Authority。",
      "SANDBOX_SNAPSHOT_REQUIREMENT_UNSATISFIED",
    );
  }
  const parsed = snapshotDescriptorSchema.safeParse(
    await registration.resolveSnapshotDescriptor(context),
  );
  if (!parsed.success) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Snapshot Descriptor 无法通过严格协议。",
      "SANDBOX_SNAPSHOT_REQUIREMENT_UNSATISFIED",
    );
  }
  const descriptor = parsed.data;
  const identity = context.identity;
  if (
    (await computeSnapshotDescriptorHash(descriptor)) !== descriptor.descriptor_hash ||
    descriptor.scope_hash !== identity.scope_hash ||
    descriptor.run_id !== identity.run_id ||
    descriptor.execution_id !== identity.execution_id ||
    descriptor.principal_id !== identity.principal_id ||
    descriptor.datasource_id !== identity.datasource_id ||
    descriptor.schema_version !== identity.schema_version
  ) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Snapshot Descriptor 的 Hash 或不可变 Identity 与当前执行不精确匹配。",
      "SANDBOX_SNAPSHOT_AUTHORITY_BREACH",
    );
  }
  if (
    (identity.snapshot_requirement.mode === "REQUIRE_REPLAYABLE" &&
      descriptor.replay_state !== "REPLAYABLE") ||
    (identity.snapshot_requirement.mode === "ALLOW_LIMITED" &&
      descriptor.replay_state === "REPLAY_UNAVAILABLE")
  ) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Snapshot Descriptor 不满足 Request 的重放要求。",
      "SANDBOX_SNAPSHOT_REQUIREMENT_UNSATISFIED",
    );
  }
  return descriptor;
}

function validateClaimIdentity(
  claim: SandboxExecutionClaim,
  identity: SandboxExecutionImmutableIdentity,
): void {
  if (!sameSandboxExecutionIdentity(claim.identity, identity)) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Claim 的不可变 Identity 与当前请求不完全相等。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
}

async function parsePrepareResult(
  input: unknown,
  identity: SandboxExecutionImmutableIdentity,
  requestedAt?: string,
): Promise<SandboxExecutionPrepareResult> {
  const parsed = sandboxExecutionPrepareResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox prepare 返回了不符合严格协议的 Authority Result。",
    );
  }
  const result = parsed.data;
  if (result.claim) {
    validateClaimIdentity(result.claim, identity);
  }
  if (result.grant) {
    if (!sameSandboxExecutionIdentity(result.grant.identity, identity)) {
      throw new SandboxExecutionAuthorityError(
        "ExecutionGrant 的不可变 Identity 与准备请求不完全相等。",
        "SANDBOX_OUTCOME_BINDING_MISMATCH",
      );
    }
    await validateExecutionGrant(result.grant);
    if (requestedAt && Date.parse(result.grant.issued_at) < Date.parse(requestedAt)) {
      throw new SandboxExecutionAuthorityError(
        "ExecutionGrant.issued_at 不能早于 prepare/recover requested_at。",
        "SANDBOX_OUTCOME_BINDING_MISMATCH",
      );
    }
  }
  return deepFreeze(result);
}

async function parseTransitionResult(
  input: unknown,
  identity: SandboxExecutionImmutableIdentity,
): Promise<SandboxExecutionTransitionResult> {
  const parsed = sandboxExecutionTransitionResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox transition 返回了不符合严格协议的 Authority Result。",
    );
  }
  if (parsed.data.claim) {
    validateClaimIdentity(parsed.data.claim, identity);
  }
  if (parsed.data.grant) {
    if (!sameSandboxExecutionIdentity(parsed.data.grant.identity, identity)) {
      throw new SandboxExecutionAuthorityError(
        "Sandbox transition 返回了换绑 Identity 的 ExecutionGrant。",
        "SANDBOX_OUTCOME_BINDING_MISMATCH",
      );
    }
    await validateExecutionGrant(parsed.data.grant);
  }
  return deepFreeze(parsed.data);
}

async function resolveStrictExecutionClaim(
  store: SandboxExecutionAuthorityStore,
  identity: SandboxExecutionImmutableIdentity,
): Promise<SandboxExecutionClaim> {
  const parsed = sandboxExecutionClaimSchema.safeParse(await store.resolveExecutionClaim(identity));
  if (!parsed.success) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Authority 无法解析当前严格 Execution Claim。",
    );
  }
  validateClaimIdentity(parsed.data, identity);
  return parsed.data;
}

async function validateOutcomeBinding(
  outcome: SandboxExecutionOutcome,
  claim: SandboxExecutionClaim,
): Promise<"CURRENT" | "LATE_CANCEL"> {
  if (
    !sameSandboxExecutionIdentity(outcome.identity, claim.identity) ||
    outcome.input_hash !== claim.identity.input_hash ||
    outcome.execution_id !== claim.identity.execution_id ||
    outcome.attempt_id !== claim.attempt_id ||
    outcome.execution_fence !== claim.fencing_token ||
    outcome.lease_id !== claim.lease_id ||
    outcome.grant_hash !== claim.grant_hash ||
    outcome.sql_artifact_hash !== claim.identity.sql_artifact_ref.content_hash ||
    outcome.cancel_epoch_at_start !== claim.grant_cancel_epoch
  ) {
    const staleAttempt =
      outcome.attempt_id !== claim.attempt_id ||
      outcome.execution_fence !== claim.fencing_token ||
      outcome.lease_id !== claim.lease_id;
    throw new SandboxExecutionAuthorityError(
      staleAttempt
        ? "Sandbox Outcome 来自旧 Attempt、Fence 或 Lease。"
        : "Sandbox Outcome 的不可变 Identity 与当前 Claim 不完全相等。",
      staleAttempt ? "SANDBOX_STALE_EXECUTION_FENCE" : "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  if (
    outcome.cancel_epoch_observed < outcome.cancel_epoch_at_start ||
    outcome.cancel_epoch_observed > claim.cancel_epoch
  ) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Outcome 的 cancel epoch 倒退或越过当前 Claim。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  if (!claim.snapshot_descriptor) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Claim 缺少用于 Outcome Binding 的 SnapshotDescriptor。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  const invalidSnapshotDescriptor =
    outcome.snapshot_descriptor_hash !== claim.snapshot_descriptor.descriptor_hash;
  const invalidFixtureManifest =
    outcome.fixture_manifest_hash !== claim.snapshot_descriptor.fixture_manifest_hash;
  const invalidSchemaManifest =
    outcome.manifest_facts.schema_manifest_hash !== claim.snapshot_descriptor.schema_manifest_hash;
  const invalidDataManifest =
    outcome.manifest_facts.data_manifest_hash !== claim.snapshot_descriptor.data_manifest_hash;
  const missingCompletedManifestRevalidation =
    outcome.terminal === "COMPLETED" && !outcome.manifest_facts.manifest_revalidated;
  const invalidOutcomeChecksum =
    (await computeSandboxExecutionOutcomeChecksum(outcome)) !== outcome.outcome_checksum;
  if (
    invalidSnapshotDescriptor ||
    invalidFixtureManifest ||
    invalidSchemaManifest ||
    invalidDataManifest ||
    missingCompletedManifestRevalidation ||
    invalidOutcomeChecksum
  ) {
    const mismatches = [
      invalidSnapshotDescriptor && "snapshot_descriptor",
      invalidFixtureManifest && "fixture_manifest",
      invalidSchemaManifest && "schema_manifest",
      invalidDataManifest && "data_manifest",
      missingCompletedManifestRevalidation && "manifest_revalidation",
      invalidOutcomeChecksum && "outcome_checksum",
    ].filter(Boolean);
    throw new SandboxExecutionAuthorityError(
      `Sandbox Outcome 的 Snapshot、Manifest 或 Checksum 与当前 Claim 不匹配：${mismatches.join(", ")}。`,
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  if (outcome.terminal === "COMPLETED") {
    const [canonicalMultisetHash, orderedResultHash] = await Promise.all([
      computeSandboxCanonicalMultisetHash(outcome.result.rows),
      computeSandboxOrderedResultHash(outcome.result),
    ]);
    if (
      outcome.canonical_multiset_facts.canonical_multiset_hash !== canonicalMultisetHash ||
      outcome.canonical_multiset_facts.ordered_result_hash !== orderedResultHash
    ) {
      throw new SandboxExecutionAuthorityError(
        "Sandbox Outcome 的 canonical multiset 或 ordered result hash 不是 Result 的规范重算值。",
        "SANDBOX_OUTCOME_BINDING_MISMATCH",
      );
    }
  }
  if (
    (await computePostgresqlExecutionSettingsHash(outcome.applied_execution_settings)) !==
      claim.identity.settings_hash ||
    !outcome.transaction.read_only ||
    (claim.snapshot_descriptor.strategy === "CONTROLLED_REVISION" &&
      outcome.transaction.isolation_level !== "REPEATABLE_READ")
  ) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox Outcome 的事务与 Settings Readback 未精确绑定当前 Identity/Snapshot。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  return claim.cancel_epoch > outcome.cancel_epoch_observed ? "LATE_CANCEL" : "CURRENT";
}

/**
 * 阶段一：Authority PostgreSQL 本地事务内完成 Exact Revision、Claim/Lease/Fence，
 * 返回可交给独立 Datasource Sandbox 的不可转移 ExecutionGrant。
 */
export async function prepareSandboxExecution(
  input: unknown,
  authority: SandboxServerAuthority,
): Promise<SandboxExecutionPrepareResult> {
  const registration = resolveRegisteredSandboxAuthority(authority);
  const store = resolveExecutionAuthorityStore(authority);
  const parsed = sandboxExecutionRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.language !== "sql") {
    throw new SandboxExecutionAuthorityError(
      "prepareSandboxExecution 只接受严格 SQL Sandbox Request。",
    );
  }
  const request = parsed.data;
  return registration.withSqlTransaction(async () => {
    const requestedAt = registration.now().toISOString();
    const binding = await resolveExecutionPermitForRequest(
      request,
      registration,
      new Date(requestedAt),
    );
    const revalidation = await revalidateExecutionAuthority(
      request,
      binding.permit,
      registration,
      requestedAt,
    );
    if (
      !(await registration.assertAuthorityFence({
        execution_permit_ref: request.payload.execution_permit_ref,
        authority_epoch: revalidation.authority_epoch,
        transaction_started_at: requestedAt,
      }))
    ) {
      throw new SandboxExecutionAuthorityError("Sandbox prepare 未通过事务内 Authority Fence。");
    }
    const identity = await buildSandboxExecutionIdentity(
      request,
      binding.permit,
      binding.sql_artifact,
    );
    const preparationContext = {
      identity,
      request,
      permit: binding.permit,
      sql_artifact: binding.sql_artifact,
      authority_revalidation: revalidation,
      requested_at: requestedAt,
    };
    const snapshotDescriptor = await resolveSnapshotDescriptorForPreparation(
      registration,
      preparationContext,
    );
    return parsePrepareResult(
      await store.prepareExecution({
        ...preparationContext,
        snapshot_descriptor: snapshotDescriptor,
      }),
      identity,
      requestedAt,
    );
  });
}

async function settleSandboxExecution(
  input: unknown,
  authority: SandboxServerAuthority,
  expectedTerminal: "COMPLETED" | "FAILED" | "CANCELLED" | "REPLAY_UNAVAILABLE",
): Promise<SandboxExecutionTransitionResult> {
  const store = resolveExecutionAuthorityStore(authority);
  const parsed = sandboxExecutionOutcomeSchema.safeParse(input);
  if (!parsed.success || parsed.data.terminal !== expectedTerminal) {
    throw new SandboxExecutionAuthorityError(
      `Sandbox ${expectedTerminal} Outcome 不符合严格协议。`,
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  const outcome = parsed.data;
  const claim = await resolveStrictExecutionClaim(store, outcome.identity);
  const cancelDisposition = await validateOutcomeBinding(outcome, claim);
  const rawResult =
    expectedTerminal === "FAILED"
      ? await store.failExecution({ identity: outcome.identity, outcome })
      : await store.finalizeExecution({ identity: outcome.identity, outcome });
  const result = await parseTransitionResult(rawResult, outcome.identity);
  if (
    cancelDisposition === "LATE_CANCEL" &&
    (result.claim?.state !== "CANCELLED" ||
      result.reason_code !== "SANDBOX_CANCELLED" ||
      result.disposition !== "CANCEL_ACCEPTED")
  ) {
    throw new SandboxExecutionAuthorityError(
      "Late cancel 必须丢弃候选并以 CANCELLED 关闭，不能提交成功 Outcome。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  return result;
}

/** 阶段三成功/取消/不可重放 CAS Finalize。 */
export async function finalizeSandboxExecution(
  input: unknown,
  authority: SandboxServerAuthority,
): Promise<SandboxExecutionTransitionResult> {
  const parsed = sandboxExecutionOutcomeSchema.safeParse(input);
  if (
    !parsed.success ||
    !["COMPLETED", "CANCELLED", "REPLAY_UNAVAILABLE"].includes(parsed.data.terminal)
  ) {
    throw new SandboxExecutionAuthorityError(
      "finalizeSandboxExecution 只接受 COMPLETED/CANCELLED/REPLAY_UNAVAILABLE Outcome。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  return settleSandboxExecution(parsed.data, authority, parsed.data.terminal);
}

/** 阶段三失败 CAS；失败 Outcome 不能产生成功 Result Artifact。 */
export function failSandboxExecution(
  input: unknown,
  authority: SandboxServerAuthority,
): Promise<SandboxExecutionTransitionResult> {
  return settleSandboxExecution(input, authority, "FAILED");
}

/** 接受取消请求并要求持久层单调增加 cancel_epoch。 */
export async function cancelSandboxExecution(
  input: unknown,
  authority: SandboxServerAuthority,
): Promise<SandboxExecutionTransitionResult> {
  const store = resolveExecutionAuthorityStore(authority);
  const request = sandboxExecutionCancelRequestSchema.parse(input);
  const claim = await resolveStrictExecutionClaim(store, request.identity);
  if (request.expected_cancel_epoch !== claim.cancel_epoch) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox cancel 的 expected_cancel_epoch 不是当前 Claim Epoch。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  const result = await parseTransitionResult(
    await store.cancelExecution(request),
    request.identity,
  );
  if (
    result.disposition === "CANCEL_ACCEPTED" &&
    (!result.claim || result.claim.cancel_epoch <= request.expected_cancel_epoch)
  ) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox cancel 被接受后必须单调增加 cancel_epoch。",
      "SANDBOX_OUTCOME_BINDING_MISMATCH",
    );
  }
  return result;
}

/** Lease 过期恢复；只能产生更高 Attempt 与 Fence，旧 Outcome 永久失效。 */
export async function recoverSandboxExecution(
  input: unknown,
  authority: SandboxServerAuthority,
): Promise<SandboxExecutionPrepareResult> {
  const store = resolveExecutionAuthorityStore(authority);
  const request = sandboxExecutionRecoveryRequestSchema.parse(input);
  const claim = await resolveStrictExecutionClaim(store, request.identity);
  if (
    request.expected_attempt_id !== claim.attempt_id ||
    request.expected_fencing_token !== claim.fencing_token
  ) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox recover 只能接管当前 Attempt/Fence。",
      "SANDBOX_STALE_EXECUTION_FENCE",
    );
  }
  const result = await parsePrepareResult(
    await store.recoverExecution(request),
    request.identity,
    request.requested_at,
  );
  if (
    result.disposition === "ACCEPTED" &&
    (!result.grant ||
      result.grant.attempt <= claim.attempt ||
      result.grant.fencing_token <= claim.fencing_token)
  ) {
    throw new SandboxExecutionAuthorityError(
      "Sandbox recovery 必须创建更高 Attempt 与 Fence。",
      "SANDBOX_STALE_EXECUTION_FENCE",
    );
  }
  return result;
}

async function resolveExecutionPermitForRequest(
  request: SqlSandboxExecutionRequest,
  registration: SandboxServerAuthorityRegistration,
  effectiveAt: Date,
): Promise<{
  readonly permit: z.infer<typeof sandboxExecutionPermitBindingSchema>;
  readonly sql_artifact: z.infer<typeof sandboxSqlArtifactBindingSchema>;
}> {
  const reference = request.payload.execution_permit_ref;
  const permit = sandboxExecutionPermitBindingSchema.safeParse(
    await registration.resolveAuthoritativeExecutionPermit(reference),
  );
  if (
    !permit.success ||
    !(await registration.verifyExactArtifactRevision(reference, permit.data))
  ) {
    throw new SandboxExecutionRequestAuthorityError(
      "SQL Sandbox Request 必须绑定 Reference 精确指向、已提交且通过五道 Gate 的权威 ExecutionPermit。",
    );
  }
  const value = permit.data;
  const sqlArtifactReference = request.payload.sql_artifact_ref;
  const sqlArtifact = sandboxSqlArtifactBindingSchema.safeParse(
    await registration.resolveAuthoritativeSqlArtifact(sqlArtifactReference),
  );
  const settingsHash = await computePostgresqlExecutionSettingsHash(
    request.payload.execution_settings,
  );
  if (
    !sqlArtifact.success ||
    !(await registration.verifyExactArtifactRevision(sqlArtifactReference, sqlArtifact.data)) ||
    (await computeSandboxSqlArtifactQueryHash(sqlArtifact.data)) !== sqlArtifact.data.query_hash ||
    !sameJson(sqlArtifact.data.parameters, request.payload.parameters) ||
    !sameReference(value.sql_artifact_ref, request.payload.sql_artifact_ref) ||
    !sameReference(value.resource_admission_ref, request.payload.resource_admission_ref) ||
    value.datasource_id !== request.payload.datasource_id ||
    value.schema_version !== request.schema_version ||
    value.settings_hash !== request.payload.settings_hash ||
    value.settings_hash !== settingsHash ||
    !sameJson(value.execution_settings, request.payload.execution_settings) ||
    !sameJson(value.budget, request.budget)
  ) {
    throw new SandboxExecutionRequestAuthorityError(
      "SQL Sandbox Request 的 SQL Parameters、ResourceAdmission、Schema、Settings 或 Budget 与权威 SqlArtifact/Permit 不一致。",
    );
  }
  const observedAt = effectiveAt.getTime();
  if (
    !Number.isFinite(observedAt) ||
    observedAt < Date.parse(value.issued_at) ||
    observedAt >= Date.parse(value.expires_at)
  ) {
    throw new SandboxExecutionRequestAuthorityError(
      "SQL Sandbox Request 只能在 ExecutionPermit 的半开有效期内开始执行。",
    );
  }
  return {
    permit: value,
    sql_artifact: sqlArtifact.data,
  };
}

async function revalidateExecutionAuthority(
  request: SqlSandboxExecutionRequest,
  permit: z.infer<typeof sandboxExecutionPermitBindingSchema>,
  registration: SandboxServerAuthorityRegistration,
  transactionStartedAt: string,
): Promise<z.infer<typeof sandboxAuthorityRevalidationSchema>> {
  const parsed = sandboxAuthorityRevalidationSchema.safeParse(
    await registration.revalidateExecutionAuthority({
      execution_permit_ref: request.payload.execution_permit_ref,
      effective_principal_id: permit.principal_id,
      policy_receipt_ref: permit.policy_receipt_ref,
      transaction_started_at: transactionStartedAt,
    }),
  );
  if (
    !parsed.success ||
    parsed.data.effective_principal_id !== permit.principal_id ||
    !sameReference(parsed.data.policy_receipt_ref, permit.policy_receipt_ref) ||
    parsed.data.revalidated_at !== transactionStartedAt ||
    !sameScopeAndRun(parsed.data.policy_receipt_ref, request.scope, request.run_id)
  ) {
    throw new SandboxExecutionRequestAuthorityError(
      "SQL Sandbox Request 在 Transaction Start 未通过当前 Principal/Policy Authority 复核。",
    );
  }
  return parsed.data;
}

export class SandboxExecutionRequestAuthorityError extends Error {
  override readonly name = "SandboxExecutionRequestAuthorityError";
  readonly code = "SANDBOX_EXECUTION_REQUEST_NOT_AUTHORIZED";
}

export class SandboxExecutionIdempotencyConflictError extends Error {
  override readonly name = "SandboxExecutionIdempotencyConflictError";
  readonly code = "SANDBOX_IDEMPOTENCY_CONFLICT";
}

export async function executeAuthorizedSandboxRequest<T>(
  input: unknown,
  authority: SandboxServerAuthority,
  operation: (
    authorization: Readonly<{
      request: SqlSandboxExecutionRequest;
      permit: z.infer<typeof sandboxExecutionPermitBindingSchema>;
      sql_artifact: z.infer<typeof sandboxSqlArtifactBindingSchema>;
      transaction_started_at: string;
      authority_revalidation: z.infer<typeof sandboxAuthorityRevalidationSchema>;
    }>,
  ) => Promise<T>,
): Promise<T> {
  const registration = resolveRegisteredSandboxAuthority(authority);
  const parsed = sandboxExecutionRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new SandboxExecutionRequestAuthorityError(
      "Sandbox Execution Request 不符合严格协议，不能执行。",
    );
  }
  const request = parsed.data;
  if (request.language !== "sql") {
    throw new SandboxExecutionRequestAuthorityError(
      "Python Sandbox 尚未定义独立 ExecutionPermit，当前必须失败关闭。",
    );
  }
  const inputHash = await computeSandboxExecutionRequestHash(request);
  return registration.withSqlTransaction(async () => {
    const transactionStartedAt = registration.now().toISOString();
    const { permit, sql_artifact: sqlArtifact } = await resolveExecutionPermitForRequest(
      request,
      registration,
      new Date(transactionStartedAt),
    );
    const authorityRevalidation = await revalidateExecutionAuthority(
      request,
      permit,
      registration,
      transactionStartedAt,
    );
    if (
      !(await registration.assertAuthorityFence({
        execution_permit_ref: request.payload.execution_permit_ref,
        authority_epoch: authorityRevalidation.authority_epoch,
        transaction_started_at: transactionStartedAt,
      }))
    ) {
      throw new SandboxExecutionRequestAuthorityError(
        "SQL Sandbox Request 在执行语句前未通过事务内 Authority Fence。",
      );
    }
    const authorization = deepFreeze({
      request,
      permit,
      sql_artifact: sqlArtifact,
      transaction_started_at: transactionStartedAt,
      authority_revalidation: authorityRevalidation,
    });
    const resolution = await registration.claimOrLoadExecution(
      {
        scope: request.scope,
        principal_id: permit.principal_id,
        idempotency_key: request.idempotency_key,
        input_hash: inputHash,
      },
      () => operation(authorization),
    );
    if (resolution.status === "CONFLICT") {
      throw new SandboxExecutionIdempotencyConflictError(
        "同一个 Sandbox Idempotency Key 已绑定不同规范输入，真实查询未执行。",
      );
    }
    return resolution.value;
  });
}

export async function authorizeSandboxResult(
  referenceInput: unknown,
  authority: SandboxServerAuthority,
): Promise<AuthoritativeSandboxResult> {
  const registration = resolveRegisteredSandboxAuthority(authority);
  const parsedReference = sandboxResultReferenceSchema.safeParse(referenceInput);
  if (!parsedReference.success) {
    throw new SandboxResultAuthorityError("SandboxResult 必须通过完整 Reference 请求授权。");
  }
  const reference = parsedReference.data;
  const parsedResult = sandboxResultSchema.safeParse(
    await registration.resolveCommitted(reference),
  );
  if (!parsedResult.success) {
    throw new SandboxResultAuthorityError(
      "SandboxResult Reference 无法解析为严格、已提交的结果 Artifact。",
    );
  }
  const result = parsedResult.data;
  if (!sameReference(result.result_ref, reference)) {
    throw new SandboxResultAuthorityError(
      "SandboxResult Resolver 返回了不匹配的 Content-Addressed Revision。",
    );
  }
  if ((await computeSandboxResultHash(result)) !== result.result_hash) {
    throw new SandboxResultAuthorityError("SandboxResult Hash 与规范化结果内容不匹配。");
  }
  if (!(await registration.verifyCommitted(result.result_ref))) {
    throw new SandboxResultAuthorityError("SandboxResult 尚未由持久化 Authority 提交。");
  }

  authorizedSandboxResults.add(result);
  const authoritativeResult = deepFreeze(result) as AuthoritativeSandboxResult;
  authorizedSandboxValueIdentities.set(
    authoritativeResult,
    resolveRegisteredSandboxAuthorityIdentity(authority),
  );
  return authoritativeResult;
}

export function isAuthoritativeSandboxResult(value: unknown): value is AuthoritativeSandboxResult {
  return typeof value === "object" && value !== null && authorizedSandboxResults.has(value);
}

export class SandboxExecutionReceiptAuthorityError extends Error {
  override readonly name = "SandboxExecutionReceiptAuthorityError";
  readonly code = "SANDBOX_EXECUTION_RECEIPT_NOT_AUTHORITATIVE";
}

declare const authoritativeSandboxExecutionReceipt: unique symbol;
const authorizedSandboxExecutionReceipts = new WeakSet<object>();

export type AuthoritativeSandboxExecutionReceipt = SuccessfulSandboxExecutionReceipt & {
  readonly [authoritativeSandboxExecutionReceipt]: true;
};

function receiptMatchesRequestAndRecord(
  receipt: SuccessfulSandboxExecutionReceipt,
  request: SqlSandboxExecutionRequest,
  record: z.infer<typeof sandboxExecutionAuthorityRecordSchema>,
): boolean {
  return (
    request.execution_id === receipt.execution_id &&
    request.idempotency_key === receipt.idempotency_key &&
    request.schema_version === receipt.schema_version &&
    sameJson(request.scope, receipt.scope) &&
    request.run_id === receipt.run_id &&
    sameReference(request.payload.sql_artifact_ref, receipt.sql_artifact_ref) &&
    sameReference(request.payload.execution_permit_ref, receipt.execution_permit_ref) &&
    sameReference(request.payload.resource_admission_ref, receipt.resource_admission_ref) &&
    request.payload.datasource_id === receipt.datasource_id &&
    request.payload.settings_hash === receipt.settings_hash &&
    sameJson(request.payload.execution_settings, receipt.execution_settings) &&
    record.started_at === receipt.started_at &&
    record.completed_at === receipt.completed_at &&
    sameReference(record.result_artifact_ref, receipt.result_artifact_ref) &&
    record.datasource_id === receipt.datasource_id &&
    record.schema_version === receipt.schema_version &&
    record.settings_hash === receipt.settings_hash &&
    sameJson(record.applied_execution_settings, receipt.execution_settings) &&
    sameJson(record.transaction, receipt.transaction) &&
    sameJson(record.authority_revalidation, receipt.authority_revalidation) &&
    sameJson(record.resource_usage, receipt.resource_usage) &&
    record.snapshot.snapshot_token === receipt.snapshot_token &&
    record.snapshot.watermark === receipt.watermark &&
    record.snapshot.replay_state === receipt.replay_state
  );
}

function snapshotSatisfiesRequirement(
  snapshot: z.infer<typeof sandboxSnapshotBindingSchema>,
  requirement: z.infer<typeof sandboxSnapshotRequirementSchema>,
): boolean {
  switch (requirement.mode) {
    case "REQUIRE_REPLAYABLE":
      return snapshot.replay_state === "REPLAYABLE";
    case "ALLOW_LIMITED":
      return snapshot.replay_state !== "REPLAY_UNAVAILABLE";
    case "ALLOW_UNAVAILABLE":
      return true;
  }
}

export async function authorizeSandboxExecutionReceipt(
  referenceInput: unknown,
  authority: SandboxServerAuthority,
): Promise<AuthoritativeSandboxExecutionReceipt> {
  let registration: SandboxServerAuthorityRegistration;
  try {
    registration = resolveRegisteredSandboxAuthority(authority);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知 Sandbox Authority 错误。";
    throw new SandboxExecutionReceiptAuthorityError(reason);
  }
  const parsedReference = sandboxExecutionReceiptReferenceSchema.safeParse(referenceInput);
  if (!parsedReference.success) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 必须通过完整 Reference 请求授权。",
    );
  }
  const reference = parsedReference.data;
  const parsedReceipt = successfulSandboxExecutionReceiptSchema.safeParse(
    await registration.resolveCommitted(reference),
  );
  if (!parsedReceipt.success) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox Receipt Reference 无法解析为严格的成功 SQL Receipt。",
    );
  }
  const receipt = parsedReceipt.data;
  const sandboxIdentity = resolveRegisteredSandboxAuthorityIdentity(authority);
  if (!sameReference(receipt.receipt_ref, reference)) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox Receipt Resolver 返回了不匹配的 Content-Addressed Revision。",
    );
  }
  if ((await computeSandboxExecutionReceiptHash(receipt)) !== receipt.execution_hash) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox Receipt Hash 与规范化执行事实不匹配。",
    );
  }
  if (
    !sameJson(receipt.executor, sandboxIdentity.identity) ||
    receipt.executor_role !== sandboxIdentity.role ||
    receipt.authority_role_policy_version !== sandboxIdentity.authority_role_policy_version
  ) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 必须绑定当前已注册的稳定 Sandbox Execution Identity。",
    );
  }
  if (!(await registration.verifyCommitted(receipt.receipt_ref))) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 未提交，不能获得持久化 Authority。",
    );
  }

  const inputHash = contentHashSchema.parse(receipt.input_hash) as ContentHash;
  const parsedRecord = sandboxExecutionAuthorityRecordSchema.safeParse(
    await registration.resolveExecutionRecord(inputHash),
  );
  if (!parsedRecord.success) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 缺少服务端记录的原始 Request 与数据库 Snapshot 事实。",
    );
  }
  const record = parsedRecord.data;
  if (record.request.language !== "sql") {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 只能绑定服务端记录的 SQL Request。",
    );
  }
  const request = record.request;
  const executionDurationMs = Date.parse(receipt.completed_at) - Date.parse(receipt.started_at);
  if (
    (await computeSandboxExecutionRequestHash(request)) !== receipt.input_hash ||
    !receiptMatchesRequestAndRecord(receipt, request, record)
  ) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 必须精确回显服务端记录的 Request、Permit、Settings 与 Snapshot。",
    );
  }
  let permit: z.infer<typeof sandboxExecutionPermitBindingSchema>;
  try {
    const binding = await registration.withSqlTransaction(() =>
      resolveExecutionPermitForRequest(request, registration, new Date(record.started_at)),
    );
    permit = binding.permit;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知 ExecutionPermit 错误。";
    throw new SandboxExecutionReceiptAuthorityError(
      `Sandbox 成功 Receipt 的 ExecutionPermit 不具备权威：${reason}`,
    );
  }
  const appliedSettingsHash = await computePostgresqlExecutionSettingsHash(
    record.applied_execution_settings,
  );
  if (
    record.datasource_id !== permit.datasource_id ||
    record.schema_version !== permit.schema_version ||
    record.settings_hash !== permit.settings_hash ||
    record.settings_hash !== appliedSettingsHash ||
    !sameJson(record.applied_execution_settings, permit.execution_settings) ||
    record.authority_revalidation.effective_principal_id !== permit.principal_id ||
    !sameReference(record.authority_revalidation.policy_receipt_ref, permit.policy_receipt_ref) ||
    Date.parse(record.authority_revalidation.revalidated_at) > Date.parse(record.started_at) ||
    !snapshotSatisfiesRequirement(record.snapshot, request.payload.snapshot_requirement)
  ) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 的实际 Datasource/Schema/Settings/Snapshot 或 Authority Prepare 时间不满足 Permit 与请求约束。",
    );
  }

  let result: AuthoritativeSandboxResult;
  try {
    result = await authorizeSandboxResult(receipt.result_artifact_ref, authority);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知 SandboxResult Authority 错误。";
    throw new SandboxExecutionReceiptAuthorityError(
      `Sandbox 成功 Receipt 的 Result 不具备权威：${reason}`,
    );
  }
  if (
    !sameReference(result.result_ref, receipt.result_artifact_ref) ||
    result.execution_id !== receipt.execution_id ||
    result.schema_version !== receipt.schema_version ||
    result.row_count !== receipt.resource_usage.rows ||
    result.bytes !== receipt.resource_usage.bytes ||
    receipt.resource_usage.elapsed_ms > request.budget.timeout_ms ||
    executionDurationMs > request.budget.timeout_ms ||
    receipt.resource_usage.rows > request.budget.max_rows ||
    receipt.resource_usage.bytes > request.budget.max_bytes ||
    receipt.resource_usage.peak_memory_mb > request.budget.max_memory_mb
  ) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 必须精确绑定同一 Execution/Schema 的权威 Result，且不能超过 Permit Budget。",
    );
  }

  authorizedSandboxExecutionReceipts.add(receipt);
  const authoritativeReceipt = deepFreeze(receipt) as AuthoritativeSandboxExecutionReceipt;
  authorizedSandboxValueIdentities.set(authoritativeReceipt, sandboxIdentity);
  return authoritativeReceipt;
}

export function isAuthoritativeSandboxExecutionReceipt(
  value: unknown,
): value is AuthoritativeSandboxExecutionReceipt {
  return (
    typeof value === "object" && value !== null && authorizedSandboxExecutionReceipts.has(value)
  );
}

export interface SandboxPort {
  execute(input: SandboxExecutionRequest): Promise<PortResult<SandboxExecutionReceipt>>;
}
