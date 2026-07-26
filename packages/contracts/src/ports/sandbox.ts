import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import {
  computePostgresqlExecutionSettingsHash,
  postgresqlExecutionSettingsSchema,
} from "../artifacts/text2sql-evidence.js";
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
        parameters: z.record(z.string(), z.json()),
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

const sandboxSqlArtifactBindingSchema = z.strictObject({
  artifact_type: z.literal("SqlArtifact"),
  logical_plan_ref: artifactReferenceFor("LogicalPlan"),
  compiler_version: versionIdentifierSchema,
  ast_hash: contentHashSchema,
  dialect: z.literal("postgresql"),
  sql: z.string().min(1).max(100_000),
  parameters: z.record(z.string(), z.json()),
  query_hash: contentHashSchema,
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

/**
 * 仅供包内服务端适配器注册持久化与执行事实 Authority。
 *
 * 此入口刻意不从 ports/index 或 package root 导出。公开调用者无法用结构相同的
 * callback 自签 WeakSet 品牌；复制 token 也不会继承 WeakMap 中的注册身份。
 */
export function registerSandboxServerAuthority(
  registration: SandboxServerAuthorityRegistration,
): SandboxServerAuthority {
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
  const authority = Object.freeze(Object.create(null)) as SandboxServerAuthority;
  registeredSandboxAuthorities.set(authority, Object.freeze({ ...registration }));
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

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
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
  return deepFreeze(result) as AuthoritativeSandboxResult;
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
    record.authority_revalidation.revalidated_at !== record.started_at ||
    !snapshotSatisfiesRequirement(record.snapshot, request.payload.snapshot_requirement)
  ) {
    throw new SandboxExecutionReceiptAuthorityError(
      "Sandbox 成功 Receipt 的实际 Datasource/Schema/Settings/Snapshot 不满足 Permit 与请求约束。",
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
  return deepFreeze(receipt) as AuthoritativeSandboxExecutionReceipt;
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
