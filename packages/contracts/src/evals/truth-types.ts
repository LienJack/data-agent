import { z } from "zod";

/**
 * Governance Truth 类型定义
 *
 * 治理评测使用四种 Truth 类型来评估 U11 语义治理服务的质量。
 * 每种 Truth 类型使用 Zod strictObject 确保多余字段被拒绝。
 */

// ============================================================
// ArithmeticPartitionTruth
// 算数分割真值 — 验证贡献计算中数值分割的准确性
// ============================================================

export const arithmeticPartitionTruthSchema = z.strictObject({
  truth_id: z.string().min(1).max(256),
  truth_type: z.literal("arithmetic_partition"),
  partition_id: z.string().min(1).max(256),
  partition_value: z.number().finite(),
  expected_share: z.number().min(0).max(1),
  actual_share: z.number().min(0).max(1),
  tolerance: z.number().min(0).max(1),
  deviation: z.number().finite(),
  within_tolerance: z.boolean(),
  measured_at: z.string().datetime(),
  description: z.string().min(1).max(4096),
});

export type ArithmeticPartitionTruth = z.infer<typeof arithmeticPartitionTruthSchema>;

// ============================================================
// InjectedFaultTruth
// 注入故障真值 — 验证治理对注入异常的检测能力
// ============================================================

export const injectedFaultTruthSchema = z.strictObject({
  truth_id: z.string().min(1).max(256),
  truth_type: z.literal("injected_fault"),
  fault_id: z.string().min(1).max(256),
  fault_type: z.enum([
    "DATA_CORRUPTION",
    "SCHEMA_MISMATCH",
    "AUTHORITY_VIOLATION",
    "REVIEW_BYPASS",
    "PUBLISH_OVERRIDE",
    "ROLLBACK_FAILURE",
  ]),
  injected_at: z.string().datetime(),
  expected_detection: z.boolean(),
  detected: z.boolean(),
  detection_latency_ms: z.number().int().nonnegative().nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  description: z.string().min(1).max(4096),
});

export type InjectedFaultTruth = z.infer<typeof injectedFaultTruthSchema>;

// ============================================================
// ExpertInvestigationPriorityLabel
// 专家调查优先级标签 — 验证治理排序与专家判断的一致性
// ============================================================

export const expertInvestigationPriorityLabelSchema = z.strictObject({
  truth_id: z.string().min(1).max(256),
  truth_type: z.literal("expert_investigation_priority"),
  case_id: z.string().min(1).max(256),
  expert_label: z.enum(["P0", "P1", "P2", "P3"]),
  system_label: z.enum(["P0", "P1", "P2", "P3"]),
  agreement: z.boolean(),
  confidence: z.number().min(0).max(1),
  expert_notes: z.string().max(4096).nullable(),
  evaluated_at: z.string().datetime(),
});

export type ExpertInvestigationPriorityLabel = z.infer<
  typeof expertInvestigationPriorityLabelSchema
>;

// ============================================================
// SCMCausalTruth
// SCM 因果真值 — 验证基于结构因果模型的归因正确性
// ============================================================

export const scmCausalTruthSchema = z.strictObject({
  truth_id: z.string().min(1).max(256),
  truth_type: z.literal("scm_causal"),
  model_id: z.string().min(1).max(256),
  model_version: z.string().min(1).max(64),
  cause_variable: z.string().min(1).max(256),
  effect_variable: z.string().min(1).max(256),
  estimated_effect: z.number().finite(),
  confidence_interval_lower: z.number().finite(),
  confidence_interval_upper: z.number().finite(),
  p_value: z.number().min(0).max(1),
  causal_direction: z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL", "UNKNOWN"]),
  significance_level: z.number().min(0).max(1),
  is_significant: z.boolean(),
  confounders_controlled: z.array(z.string().min(1)),
  description: z.string().min(1).max(4096),
});

export type SCMCausalTruth = z.infer<typeof scmCausalTruthSchema>;
