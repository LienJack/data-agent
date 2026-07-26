import { z } from "zod";
import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  EXECUTABLE_QUERY_LIMITS,
  immutableIdSchema,
  postgresqlOutputAliasSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { artifactReferenceFor, artifactReferenceIdentity } from "./envelope.js";

const stableIdentifierListSchema = z.array(versionIdentifierSchema).superRefine((values, ctx) => {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => {
      const previous = values[index - 1];
      return previous !== undefined && previous >= value;
    })
  ) {
    ctx.addIssue({
      code: "custom",
      message: "权威证据中的标识符列表必须唯一并按字典序排列。",
    });
  }
});

/**
 * PostgreSQL `EXPLAIN (FORMAT JSON)` 的 `Node Type` 原值。
 *
 * 保留空格并执行精确比较，不能把 `Nested Loop` 归一化成 `NestedLoop`。
 */
export const postgresqlPlanNodeTypeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/,
    "PostgreSQL Plan Node Type 必须保留由单个空格分隔的原始 ASCII 名称。",
  );

const sortedPostgresqlPlanNodeTypeListSchema = z
  .array(postgresqlPlanNodeTypeSchema)
  .superRefine((values, ctx) => {
    if (
      new Set(values).size !== values.length ||
      values.some((value, index) => {
        const previous = values[index - 1];
        return previous !== undefined && previous >= value;
      })
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt 的 Node Type 必须唯一并按字典序排列。",
      });
    }
  });

const resourceEstimateMaterialSchema = z.strictObject({
  query_hash: contentHashSchema,
  datasource_id: immutableIdSchema,
  schema_version: versionIdentifierSchema,
  settings_hash: contentHashSchema,
  total_cost: z.number().finite().nonnegative(),
  plan_rows: z.number().int().nonnegative(),
  plan_width: z.number().int().nonnegative(),
  node_types: sortedPostgresqlPlanNodeTypeListSchema.min(1),
  relation_names: stableIdentifierListSchema,
  has_cartesian_join: z.boolean(),
});

export const postgresqlExecutionSettingsSchema = z.strictObject({
  database_role: versionIdentifierSchema,
  search_path: z
    .array(
      z
        .string()
        .min(1)
        .max(63)
        .regex(/^[a-z_][a-z0-9_]*$/, "PostgreSQL search_path 只能包含规范化非引用标识符。"),
    )
    .min(1),
  plan_cache_mode: z.literal("force_custom_plan"),
  statement_timeout_ms: z.number().int().positive().max(300_000),
  lock_timeout_ms: z.number().int().positive().max(300_000),
});

const resourceAdmissionReceiptObjectSchema = z.strictObject({
  artifact_type: z.literal("ResourceAdmissionReceipt"),
  receipt_ref: artifactReferenceFor("ResourceAdmissionReceipt"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  principal_id: z.string().min(1).max(256),
  policy_receipt_ref: artifactReferenceFor("PolicyReceipt"),
  ...resourceEstimateMaterialSchema.shape,
  execution_settings: postgresqlExecutionSettingsSchema,
  estimate_hash: contentHashSchema,
  policy_version: versionIdentifierSchema,
  forbidden_node_types: sortedPostgresqlPlanNodeTypeListSchema,
  max_total_cost: z.number().finite().positive(),
  max_plan_rows: z.number().int().positive(),
  max_plan_bytes: z.number().int().positive(),
  lock_timeout_ms: z.number().int().positive().max(300_000),
  timeout_ms: z.number().int().positive().max(300_000),
  max_rows: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_rows),
  max_bytes: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_bytes),
  max_memory_mb: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_memory_mb),
  evaluated_at: timestampSchema,
  receipt_hash: contentHashSchema,
});

function sameScope(
  reference: z.infer<ReturnType<typeof artifactReferenceFor>>,
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

export const resourceAdmissionReceiptSchema = resourceAdmissionReceiptObjectSchema.superRefine(
  (receipt, ctx) => {
    if (
      !sameScope(receipt.receipt_ref, receipt.scope, receipt.run_id) ||
      !sameScope(receipt.sql_artifact_ref, receipt.scope, receipt.run_id) ||
      !sameScope(receipt.policy_receipt_ref, receipt.scope, receipt.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt 与 SqlArtifact 必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
    if (receipt.receipt_ref.content_hash !== receipt.receipt_hash) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt Reference 必须携带 Receipt Hash。",
        path: ["receipt_ref", "content_hash"],
      });
    }
    if (receipt.lock_timeout_ms >= receipt.timeout_ms) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt.lock_timeout_ms 必须小于 timeout_ms。",
        path: ["lock_timeout_ms"],
      });
    }
    if (
      receipt.execution_settings.statement_timeout_ms !== receipt.timeout_ms ||
      receipt.execution_settings.lock_timeout_ms !== receipt.lock_timeout_ms ||
      new Set(receipt.execution_settings.search_path).size !==
        receipt.execution_settings.search_path.length
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "ResourceAdmissionReceipt 的 PostgreSQL Settings 必须唯一且与 Timeout Policy 精确一致。",
        path: ["execution_settings"],
      });
    }
    const plannedBytes = receipt.plan_rows * receipt.plan_width;
    if (!Number.isSafeInteger(plannedBytes)) {
      ctx.addIssue({
        code: "custom",
        message: "ResourceAdmissionReceipt 计划字节数必须可安全计算。",
        path: ["plan_rows"],
      });
    }
  },
);

export type ResourceAdmissionReceipt = z.infer<typeof resourceAdmissionReceiptSchema>;

export async function computePostgresqlExecutionSettingsHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(postgresqlExecutionSettingsSchema.parse(input));
}

export async function computeResourceEstimateHash(input: unknown): Promise<`sha256:${string}`> {
  const receipt = resourceAdmissionReceiptObjectSchema.safeParse(input);
  const material = receipt.success
    ? {
        query_hash: receipt.data.query_hash,
        datasource_id: receipt.data.datasource_id,
        schema_version: receipt.data.schema_version,
        settings_hash: receipt.data.settings_hash,
        total_cost: receipt.data.total_cost,
        plan_rows: receipt.data.plan_rows,
        plan_width: receipt.data.plan_width,
        node_types: receipt.data.node_types,
        relation_names: receipt.data.relation_names,
        has_cartesian_join: receipt.data.has_cartesian_join,
      }
    : input;
  return sha256ContentHash(resourceEstimateMaterialSchema.parse(material));
}

export async function computeResourceAdmissionReceiptHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const receipt = resourceAdmissionReceiptSchema.parse(input);
  const {
    receipt_hash: _receiptHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

const resultInvariantVerdictSchema = z.strictObject({
  invariant_id: versionIdentifierSchema,
  verdict: z.enum(["PASS", "FAIL"]),
});

const resultOracleEvidenceMaterialSchema = z.strictObject({
  oracle_version: versionIdentifierSchema,
  query_hash: contentHashSchema,
  result_hash: contentHashSchema,
  result_columns: z
    .array(postgresqlOutputAliasSchema)
    .min(1)
    .max(EXECUTABLE_QUERY_LIMITS.max_columns),
  row_count: z.number().int().nonnegative().max(EXECUTABLE_QUERY_LIMITS.max_rows),
  invariant_verdicts: z.array(resultInvariantVerdictSchema).min(1),
  oracle_verdict: z.enum(["PASS", "FAIL"]),
  result_artifact_ref: artifactReferenceFor("SandboxResult"),
});

const resultOracleReceiptObjectSchema = z.strictObject({
  artifact_type: z.literal("ResultOracleReceipt"),
  receipt_ref: artifactReferenceFor("ResultOracleReceipt"),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  sql_artifact_ref: artifactReferenceFor("SqlArtifact"),
  execution_receipt_ref: artifactReferenceFor("ExecutionReceipt"),
  ...resultOracleEvidenceMaterialSchema.shape,
  evidence_hash: contentHashSchema,
  evaluated_at: timestampSchema,
  receipt_hash: contentHashSchema,
});

export const resultOracleReceiptSchema = resultOracleReceiptObjectSchema.superRefine(
  (receipt, ctx) => {
    const references = [
      receipt.receipt_ref,
      receipt.sql_artifact_ref,
      receipt.execution_receipt_ref,
      receipt.result_artifact_ref,
    ];
    if (references.some((reference) => !sameScope(reference, receipt.scope, receipt.run_id))) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt 的全部引用必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
    if (receipt.receipt_ref.content_hash !== receipt.receipt_hash) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt Reference 必须携带 Receipt Hash。",
        path: ["receipt_ref", "content_hash"],
      });
    }
    const invariantIds = receipt.invariant_verdicts.map(({ invariant_id }) => invariant_id);
    if (new Set(invariantIds).size !== invariantIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt invariant_id 必须唯一。",
        path: ["invariant_verdicts"],
      });
    }
    const hasFailure = receipt.invariant_verdicts.some(({ verdict }) => verdict === "FAIL");
    if ((receipt.oracle_verdict === "PASS") === hasFailure) {
      ctx.addIssue({
        code: "custom",
        message: "ResultOracleReceipt 总 Verdict 必须与逐项 Invariant Verdict 一致。",
        path: ["oracle_verdict"],
      });
    }
  },
);

export type ResultOracleReceipt = z.infer<typeof resultOracleReceiptSchema>;

export async function computeResultOracleEvidenceHash(input: unknown): Promise<`sha256:${string}`> {
  const receipt = resultOracleReceiptObjectSchema.safeParse(input);
  const material = resultOracleEvidenceMaterialSchema.parse(
    receipt.success
      ? {
          oracle_version: receipt.data.oracle_version,
          query_hash: receipt.data.query_hash,
          result_hash: receipt.data.result_hash,
          result_columns: receipt.data.result_columns,
          row_count: receipt.data.row_count,
          invariant_verdicts: receipt.data.invariant_verdicts,
          oracle_verdict: receipt.data.oracle_verdict,
          result_artifact_ref: receipt.data.result_artifact_ref,
        }
      : input,
  );
  return sha256ContentHash(material);
}

export async function computeResultOracleReceiptHash(input: unknown): Promise<`sha256:${string}`> {
  const receipt = resultOracleReceiptSchema.parse(input);
  const {
    receipt_hash: _receiptHash,
    receipt_ref: { content_hash: _referenceHash, ...receiptReference },
    ...material
  } = receipt;
  return sha256ContentHash({
    ...material,
    receipt_ref: receiptReference,
  });
}

export function sameText2SqlEvidenceReference(
  left: z.infer<ReturnType<typeof artifactReferenceFor>>,
  right: z.infer<ReturnType<typeof artifactReferenceFor>>,
): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

export function canonicalText2SqlEvidence(input: unknown): string {
  return canonicalizeJson(input);
}
