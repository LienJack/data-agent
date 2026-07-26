import {
  type ArtifactReference,
  type AuthoritativeSandboxResult,
  contentHashSchema,
  EXECUTABLE_QUERY_LIMITS,
  type ExecutionReceiptPayload,
  immutableIdSchema,
  postgresqlOutputAliasSchema,
  postgresqlPlanNodeTypeSchema,
  type QueryContractPayload,
  type ResourceAdmissionReceipt,
  type ResultOracleReceipt,
  type TEXT2SQL_GATE_EVALUATOR_VERSION,
  type TEXT2SQL_GATES,
  type TEXT2SQL_PRE_EXECUTION_GATES,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";

export {
  TEXT2SQL_GATE_EVALUATOR_VERSION,
  TEXT2SQL_GATE_REASON_CODES,
} from "@data-agent/contracts";

export type Text2SqlGate = (typeof TEXT2SQL_GATES)[number];
export type PreExecutionGate = (typeof TEXT2SQL_PRE_EXECUTION_GATES)[number];
export type PostExecutionGate = Exclude<Text2SqlGate, PreExecutionGate>;
export type GateVerdict = "PASS" | "FAIL" | "UNAVAILABLE";

export const resourcePolicySchema = z
  .strictObject({
    policy_version: versionIdentifierSchema,
    max_total_cost: z.number().finite().positive(),
    max_plan_rows: z.number().int().positive(),
    max_plan_bytes: z.number().int().positive(),
    forbidden_node_types: z.array(postgresqlPlanNodeTypeSchema),
    statement_timeout_ms: z.number().int().positive().max(300_000),
    lock_timeout_ms: z.number().int().positive().max(300_000),
    max_rows: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_rows),
    max_bytes: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_bytes),
    max_memory_mb: z.number().int().positive().max(EXECUTABLE_QUERY_LIMITS.max_memory_mb),
  })
  .superRefine((policy, ctx) => {
    if (policy.lock_timeout_ms >= policy.statement_timeout_ms) {
      ctx.addIssue({
        code: "custom",
        message: "ResourcePolicy.lock_timeout_ms 必须小于 statement_timeout_ms。",
        path: ["lock_timeout_ms"],
      });
    }
    if (new Set(policy.forbidden_node_types).size !== policy.forbidden_node_types.length) {
      ctx.addIssue({
        code: "custom",
        message: "ResourcePolicy.forbidden_node_types 必须唯一。",
        path: ["forbidden_node_types"],
      });
    }
  });

export const postgresqlExplainEstimateSchema = z
  .strictObject({
    query_hash: contentHashSchema,
    datasource_id: immutableIdSchema,
    schema_version: versionIdentifierSchema,
    settings_hash: contentHashSchema,
    explain_format: z.literal("JSON"),
    analyze: z.literal(false),
    total_cost: z.number().finite().nonnegative(),
    plan_rows: z.number().int().nonnegative(),
    plan_width: z.number().int().nonnegative(),
    node_types: z.array(postgresqlPlanNodeTypeSchema).min(1),
    relation_names: z.array(z.string().min(1).max(256)),
    has_cartesian_join: z.boolean(),
  })
  .superRefine((estimate, ctx) => {
    if (new Set(estimate.node_types).size !== estimate.node_types.length) {
      ctx.addIssue({
        code: "custom",
        message: "EXPLAIN node_types 必须唯一。",
        path: ["node_types"],
      });
    }
    if (new Set(estimate.relation_names).size !== estimate.relation_names.length) {
      ctx.addIssue({
        code: "custom",
        message: "EXPLAIN relation_names 必须唯一。",
        path: ["relation_names"],
      });
    }
  });

export type ResourcePolicy = z.infer<typeof resourcePolicySchema>;
export type PostgresqlExplainEstimate = z.infer<typeof postgresqlExplainEstimateSchema>;

declare const trustedResourceAdmissionBrand: unique symbol;

/**
 * 由包内 PostgreSQL EXPLAIN 适配器创建的 Resource admission。
 *
 * 注册入口刻意不从 package root 导出；公开调用者即使复制出同形 JSON，
 * 也无法把未经数据库与运行配置验证的估算升级成可签发 Permit 的权威输入。
 */
export type TrustedResourceAdmission = Readonly<{
  receipt: ResourceAdmissionReceipt;
  policy: ResourcePolicy;
  estimate: PostgresqlExplainEstimate | null;
  expected_schema_version: string;
  expected_settings_hash: `sha256:${string}`;
  expected_relation_names: readonly string[];
  readonly [trustedResourceAdmissionBrand]: true;
}>;

export const resultOracleVerdictSchema = z
  .strictObject({
    oracle_version: versionIdentifierSchema,
    query_hash: contentHashSchema,
    result_hash: contentHashSchema,
    result_columns: z
      .array(postgresqlOutputAliasSchema)
      .min(1)
      .max(EXECUTABLE_QUERY_LIMITS.max_columns),
    row_count: z.number().int().nonnegative().max(EXECUTABLE_QUERY_LIMITS.max_rows),
    invariant_verdicts: z
      .array(
        z.strictObject({
          invariant_id: versionIdentifierSchema,
          verdict: z.enum(["PASS", "FAIL"]),
        }),
      )
      .min(1),
    oracle_verdict: z.enum(["PASS", "FAIL"]),
    evidence_hash: contentHashSchema,
  })
  .superRefine((verdict, ctx) => {
    const invariantIds = verdict.invariant_verdicts.map(({ invariant_id }) => invariant_id);
    if (new Set(invariantIds).size !== invariantIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "Result Oracle invariant_id 必须唯一。",
        path: ["invariant_verdicts"],
      });
    }
    const hasFailure = verdict.invariant_verdicts.some(({ verdict: state }) => state === "FAIL");
    if ((verdict.oracle_verdict === "PASS") === hasFailure) {
      ctx.addIssue({
        code: "custom",
        message: "Result Oracle 总 verdict 必须与 invariant verdicts 一致。",
        path: ["oracle_verdict"],
      });
    }
  });

export type ResultOracleVerdict = z.infer<typeof resultOracleVerdictSchema>;

export interface ResultOracleAuthority {
  evaluate(
    input: Readonly<{
      query_contract: QueryContractPayload;
      execution_receipt: ExecutionReceiptPayload;
      sandbox_result: AuthoritativeSandboxResult;
    }>,
  ): Promise<ResultOracleReceipt["receipt_ref"] | null>;
}

export interface IntentGateObservations {
  readonly query_contract_hash: `sha256:${string}`;
  readonly intent_signature_hash: `sha256:${string}`;
}

export interface SemanticGateObservations {
  readonly logical_plan_hash: `sha256:${string}`;
  readonly semantic_hash: `sha256:${string}`;
  readonly grounding_hash: `sha256:${string}`;
}

export interface StructuralGateObservations {
  readonly compiler_version: string;
  readonly ast_hash: `sha256:${string}`;
  readonly query_hash: `sha256:${string}`;
  readonly parameter_count: number;
  readonly statement_kind: "SELECT" | "UNAVAILABLE";
  readonly read_only: boolean;
}

export interface PolicyGateObservations {
  readonly policy_version: string;
  readonly mandatory_predicate_count: number;
  readonly resolved_binding_count: number;
}

export interface ResourceGateObservations {
  readonly estimate_hash: `sha256:${string}`;
  readonly policy_version: string;
  readonly total_cost: number;
  readonly plan_rows: number;
  readonly plan_width: number;
  readonly planned_bytes: number;
  readonly timeout_ms: number;
  readonly lock_timeout_ms: number;
  readonly max_rows: number;
  readonly max_bytes: number;
  readonly max_memory_mb: number;
}

export interface ExecutionGateObservations {
  readonly query_hash: `sha256:${string}`;
  readonly sandbox_execution_hash: `sha256:${string}`;
  readonly elapsed_ms: number;
  readonly rows: number;
  readonly bytes: number;
}

export interface ResultGateObservations {
  readonly result_hash: `sha256:${string}`;
  readonly oracle_version: string;
  readonly invariant_ids: readonly string[];
  readonly oracle_evidence_hash: `sha256:${string}`;
}

export interface GateObservationMap {
  readonly INTENT: IntentGateObservations;
  readonly SEMANTIC: SemanticGateObservations;
  readonly STRUCTURAL: StructuralGateObservations;
  readonly POLICY: PolicyGateObservations;
  readonly RESOURCE: ResourceGateObservations;
  readonly EXECUTION: ExecutionGateObservations;
  readonly RESULT: ResultGateObservations;
}

declare const trustedGateEvaluation: unique symbol;

export type TrustedGateEvaluation<G extends Text2SqlGate = Text2SqlGate> = Readonly<{
  gate: G;
  gate_version: typeof TEXT2SQL_GATE_EVALUATOR_VERSION;
  sql_artifact_ref: ArtifactReference;
  execution_receipt_ref: ArtifactReference | null;
  evidence_refs: readonly ArtifactReference[];
  verdict: GateVerdict;
  reason_code: string;
  evaluated_at: string;
  input_hash: `sha256:${string}`;
  evaluation_hash: `sha256:${string}`;
  observations: GateObservationMap[G];
  readonly [trustedGateEvaluation]: true;
}>;

export type PreExecutionGateSuite = Readonly<{
  state: "EVALUATED";
  gates: readonly [
    TrustedGateEvaluation<"INTENT">,
    TrustedGateEvaluation<"SEMANTIC">,
    TrustedGateEvaluation<"STRUCTURAL">,
    TrustedGateEvaluation<"POLICY">,
    TrustedGateEvaluation<"RESOURCE">,
  ];
  permit_eligible: boolean;
}>;

export type PostExecutionGateSuite = Readonly<{
  state: "EVALUATED";
  gates: readonly [TrustedGateEvaluation<"EXECUTION">, TrustedGateEvaluation<"RESULT">];
  validation_eligible: boolean;
}>;
