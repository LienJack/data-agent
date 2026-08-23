import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../../common/index.js";
import { modelProviderSchema } from "../../providers/index.js";

export const U6_WIRE_LIMITS = Object.freeze({
  max_dimensions: 32,
  max_metric_refs: 32,
  max_success_criteria: 32,
  max_required_disclosures: 32,
  max_hypotheses: 8,
  max_predictions_per_hypothesis: 32,
  max_falsifiers_per_hypothesis: 32,
  max_tests_per_hypothesis: 32,
  max_obligations: 32,
  max_hypothesis_refs_per_obligation: 8,
  max_criterion_refs_per_obligation: 32,
  max_dependencies_per_obligation: 32,
  max_reason_codes: 32,
  max_artifact_input_refs: 256,
  max_recursive_closure_nodes: 1024,
  max_dependency_depth: 32,
  max_artifact_bytes: 1_048_576,
  max_resolved_closure_bytes: 16_777_216,
} as const);

export const RESEARCH_RUNTIME_LIMITS = Object.freeze({
  max_steps: 24,
  max_model_calls: 32,
  max_sql_executions: 16,
  max_source_calls: 0,
  max_elapsed_ms: 600_000,
  max_provider_input_tokens_per_call: 32_000,
  max_provider_output_tokens_per_call: 8_000,
  max_provider_tokens_per_run: 256_000,
  max_provider_cost_microusd_per_run: 5_000_000,
} as const);

export const U6_RESEARCH_REASON_CODES = [
  "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE",
  "EVIDENCE_PLAN_REPLAN_REQUIRED",
  "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
  "ATOMIC_CLAIM_OBSERVATION_MISMATCH",
  "OBSERVATION_NULL_REJECTED",
  "OBSERVATION_EMPTY_AFTER_NULL_FILTER",
  "OBSERVATION_RATIO_DENOMINATOR_INVALID",
  "EVIDENCE_SUPPORT_INSUFFICIENT",
  "MATERIAL_CONFLICT_UNDISCLOSED",
  "CRITICAL_OBLIGATION_FAILED",
  "EVIDENCE_REVISION_STALE",
  "OBLIGATION_SATISFIED",
  "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION",
  "EVIDENCE_COVERAGE_INSUFFICIENT",
  "ANALYSIS_INCONCLUSIVE",
  "REPORT_PROJECTION_AUTHORITY_INVALID",
  "REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE",
  "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED",
  "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED",
  "REPORT_READY_AUTHORITY_REQUIRED",
  "REPORT_READY_CERTIFICATE_TAMPERED",
  "CERTIFICATE_SEMANTIC_HASH_MISMATCH",
  "READINESS_REVOKED_DURING_CONSUMPTION",
  "RESEARCH_STOP_INPUT_INCONSISTENT",
  "UNSUPPORTED_SOURCE_KIND",
  "HYPOTHESIS_COLLAPSE",
  "SEMANTIC_REVISION_CHANGED",
  "SCHEMA_REVISION_CHANGED",
  "DATA_SNAPSHOT_STALE",
  "POLICY_CHANGED",
  "IDENTITY_AUTHORITY_CHANGED",
  "EVIDENCE_REVOKED",
  "CERTIFICATE_TAMPERED",
  "CURRENT_READINESS_REVOKED",
  "MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED",
  "RESEARCH_RESOURCE_LIMIT_EXCEEDED",
] as const;

export const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const principalIdSchema = z.string().min(1).max(256);
export const idempotencyKeySchema = z.string().min(1).max(256);
export const nonEmptyTextSchema = z.string().min(1).max(2_000);
export const shortNonEmptyTextSchema = z.string().min(1).max(256);
export const hmacSha256Schema = z
  .string()
  .regex(/^hmac-sha256:[a-f0-9]{64}$/, "必须使用 hmac-sha256:<64-hex> 摘要");
export const nonNegativeIntSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const positiveIntSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const finiteNumberSchema = z.number().finite();
export const u6ResearchReasonCodeSchema = z.enum(U6_RESEARCH_REASON_CODES);

export {
  contentHashSchema,
  immutableIdSchema,
  modelProviderSchema,
  timestampSchema,
  versionIdentifierSchema,
};

export type U6ResearchReasonCode = z.infer<typeof u6ResearchReasonCodeSchema>;

export function addUniqueIssues<T>(
  values: readonly T[],
  identity: (value: T) => string,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const key = identity(value);
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message, path: [...path, index] });
    }
    seen.add(key);
  }
}

export function uniqueStringArraySchema(min: number, max: number) {
  return z
    .array(z.string().min(1).max(2_000))
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(values, (value) => value, ctx, [], "数组成员必须唯一。");
    });
}

export function uniqueIdentifierArraySchema(min: number, max: number) {
  return z
    .array(identifierSchema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(values, (value) => value, ctx, [], "Identifier 必须唯一。");
    });
}

export function uniqueReasonCodeArraySchema(min = 0) {
  return z
    .array(u6ResearchReasonCodeSchema)
    .min(min)
    .max(U6_WIRE_LIMITS.max_reason_codes)
    .superRefine((values, ctx) => {
      addUniqueIssues(values, (value) => value, ctx, [], "Reason Code 必须唯一。");
    });
}
