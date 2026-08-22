import { z } from "zod";
import { contentHashSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

// ─── Truth Kind ────────────────────────────────────────────────────────────────

/**
 * Kinds of truth used in attribution evaluation.
 * Each kind has distinct verification requirements and protocols.
 *
 * - ARITHMETIC_PARTITION: A mathematical decomposition truth (e.g., revenue = sum of drivers)
 * - INJECTED_FAULT: A deliberately injected fault for testing oracle sensitivity
 * - EXPERT_PRIORITY: Expert-labeled priority for investigation candidates
 * - SCM_CAUSAL: Structural causal model causal truth
 */
export const truthKindSchema = z.enum([
  "ARITHMETIC_PARTITION",
  "INJECTED_FAULT",
  "EXPERT_PRIORITY",
  "SCM_CAUSAL",
]);
export type TruthKind = z.infer<typeof truthKindSchema>;

// ─── ArithmeticPartitionTruth ──────────────────────────────────────────────────

/**
 * Arithmetic partition truth: defines expected mathematical relationships
 * between outcome and driver metrics.
 *
 * Example: total_revenue = sum(promotion_revenue, base_revenue, refund_adjustment)
 */
export const contributionArithmeticPartitionTruthSchema = z.strictObject({
  truth_id: immutableIdSchema,
  kind: z.literal("ARITHMETIC_PARTITION"),
  label: z.string().min(1).max(256),
  description: z.string().min(1).max(2048),
  outcome_metric: z.string().min(1).max(256),
  driver_metrics: z.array(z.string().min(1).max(256)).min(1),
  partition_expression: z.string().min(1).max(1024),
  expected_closure: z.enum(["SUM_EQUALS", "SHARE_OF", "SUM_OF_SHARES"]),
  tolerance: z.number().min(0).max(1).default(0.001),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ContributionArithmeticPartitionTruth = z.infer<
  typeof contributionArithmeticPartitionTruthSchema
>;

// ─── InjectedFaultTruth ────────────────────────────────────────────────────────

/**
 * Injected fault truth: defines a deliberately injected fault for testing
 * oracle sensitivity and mutation detection.
 */
export const contributionInjectedFaultTruthSchema = z.strictObject({
  fault_id: immutableIdSchema,
  kind: z.literal("INJECTED_FAULT"),
  label: z.string().min(1).max(256),
  description: z.string().min(1).max(2048),
  injection_point: z.string().min(1).max(512),
  expected_detection: z.enum(["DETECTED", "UNDETECTED", "PARTIAL"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  mutation_protocol: z.string().min(1).max(1024),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ContributionInjectedFaultTruth = z.infer<typeof contributionInjectedFaultTruthSchema>;

// ─── ExpertPriorityTruth ───────────────────────────────────────────────────────

/**
 * Expert priority truth: expert-labeled priority for investigation candidates.
 * Used for evaluating whether the system correctly prioritizes high-impact drivers.
 */
export const contributionExpertPriorityTruthSchema = z.strictObject({
  priority_id: immutableIdSchema,
  kind: z.literal("EXPERT_PRIORITY"),
  label: z.string().min(1).max(256),
  description: z.string().min(1).max(2048),
  driver_metric: z.string().min(1).max(256),
  expert_priority: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]),
  confidence: z.number().min(0).max(1).default(0.5),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ContributionExpertPriorityTruth = z.infer<typeof contributionExpertPriorityTruthSchema>;

// ─── SCM Causal Truth ──────────────────────────────────────────────────────────

/**
 * SCM causal truth: structural causal model causal truth.
 * This is a DEFERRED type for future implementation.
 */
export const contributionScmCausalTruthSchema = z
  .strictObject({
    causal_id: immutableIdSchema,
    kind: z.literal("SCM_CAUSAL"),
    label: z.string().min(1).max(256),
    description: z.string().min(1).max(2048),
    treatment_variable: z.string().min(1).max(256),
    outcome_variable: z.string().min(1).max(256),
    expected_effect: z.enum(["POSITIVE", "NEGATIVE", "ZERO", "UNKNOWN"]),
    effect_size: z.number().finite().optional(),
    effect_interval: z
      .strictObject({ low: z.number().finite(), high: z.number().finite() })
      .optional(),
    directed_edges: z
      .array(
        z.strictObject({
          source: z.string().min(1).max(256),
          target: z.string().min(1).max(256),
        }),
      )
      .max(512)
      .optional(),
    observed_confounders: z.array(z.string().min(1).max(256)).max(64).optional(),
    unobserved_confounders: z.array(z.string().min(1).max(256)).max(64).optional(),
    mediators: z.array(z.string().min(1).max(256)).max(64).optional(),
    colliders: z.array(z.string().min(1).max(256)).max(64).optional(),
    data_generating_process_version: z.string().min(1).max(64).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((truth, ctx) => {
    if (
      truth.effect_interval &&
      (truth.effect_interval.low > truth.effect_interval.high ||
        (truth.effect_size !== undefined &&
          (truth.effect_size < truth.effect_interval.low ||
            truth.effect_size > truth.effect_interval.high)))
    ) {
      ctx.addIssue({ code: "custom", message: "SCM effect truth interval 无效。" });
    }
  });
export type ContributionScmCausalTruth = z.infer<typeof contributionScmCausalTruthSchema>;

// ─── Union type for all truth kinds ────────────────────────────────────────────

export const contributionTruthPayloadSchema = z.discriminatedUnion("kind", [
  contributionArithmeticPartitionTruthSchema,
  contributionInjectedFaultTruthSchema,
  contributionExpertPriorityTruthSchema,
  contributionScmCausalTruthSchema,
]);
export type ContributionTruthPayload = z.infer<typeof contributionTruthPayloadSchema>;

// ─── Truth Contract Ready Receipt ──────────────────────────────────────────────

/**
 * TRUTH_CONTRACT_READY receipt: content-addressed receipt proving that
 * a specific truth contract has been frozen and verified.
 * U13.1 must consume this exact ref/hash.
 */
export const truthContractReadyReceiptSchema = z.strictObject({
  protocol_version: z.literal("truth-contract-ready-receipt@1"),
  receipt_id: immutableIdSchema,
  truth_contract_id: z.string().min(1).max(128),
  truth_contract_hash: contentHashSchema,
  truth_count: z.number().int().positive(),
  truth_kinds: z.array(truthKindSchema).min(1),
  verified_at: timestampSchema,
  verifier_version: z.string().min(1).max(64),
  receipt_hash: contentHashSchema,
});
export type TruthContractReadyReceipt = z.infer<typeof truthContractReadyReceiptSchema>;

// ─── Oracle Mutation Protocol ──────────────────────────────────────────────────

/**
 * Oracle mutation protocol: defines how a truth contract's oracle is tested
 * through controlled mutations.
 */
export const oracleMutationProtocolSchema = z.strictObject({
  protocol_id: immutableIdSchema,
  protocol_version: z.literal("oracle-mutation-protocol@1"),
  truth_contract_id: z.string().min(1).max(128),
  mutations: z
    .array(
      z.object({
        mutation_id: immutableIdSchema,
        mutation_type: z.enum(["ROW_DELETION", "ROW_INSERTION", "VALUE_CHANGE", "AGGREGATE_SHIFT"]),
        target_table: z.string().min(1).max(256),
        target_column: z.string().min(1).max(256).optional(),
        mutation_parameters: z.record(z.string(), z.unknown()).default({}),
        expected_oracle_response: z.enum(["PASS", "HOLD", "REFUSE"]),
      }),
    )
    .min(1),
  budget: z.object({
    max_mutations_per_run: z.number().int().positive().default(10),
    max_rows_affected: z.number().int().positive().default(100),
  }),
  created_at: timestampSchema,
});
export type OracleMutationProtocol = z.infer<typeof oracleMutationProtocolSchema>;

// ─── Demo/Holdout Identity ─────────────────────────────────────────────────────

/**
 * Demo/Holdout identity: identifies a dataset split for demo vs holdout use.
 * Holdout data is reserved for final validation and must not be used during training.
 */
export const demoHoldoutIdentitySchema = z.strictObject({
  identity_id: immutableIdSchema,
  dataset_id: z.string().min(1).max(256),
  split: z.enum(["DEMO", "HOLDOUT"]),
  split_ratio: z.number().min(0).max(1),
  row_count: z.number().int().nonnegative(),
  fingerprint: contentHashSchema,
  created_at: timestampSchema,
});
export type DemoHoldoutIdentity = z.infer<typeof demoHoldoutIdentitySchema>;
