import crypto from "node:crypto";
import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

export const ATTRIBUTION_FEASIBILITY_VERDICT_VERSION = "attribution-feasibility-verdict@1" as const;

/**
 * Verdict values for the U7 Attribution Feasibility Verdict.
 *
 * FEASIBLE_FOR_PUBLISHED_INTEGRATION: The kernel evidence is feasible for
 *   published integration. All oracle, mutation, and holdout checks pass.
 * NARROW_SCOPE: Feasible but with narrow scope. Some checks pass but
 *   limitations exist.
 * EXPAND_IR: Needs investigation report expansion. The evidence is valid
 *   but the investigation report needs more work.
 * STOP: Not feasible. Critical checks failed.
 */
export const attributionFeasibilityVerdictValueSchema = z.enum([
  "FEASIBLE_FOR_PUBLISHED_INTEGRATION",
  "NARROW_SCOPE",
  "EXPAND_IR",
  "STOP",
]);
export type AttributionFeasibilityVerdictValue = z.infer<
  typeof attributionFeasibilityVerdictValueSchema
>;

/**
 * Oracle check result schema.
 * Evaluates whether the kernel evidence matches the truth contract expectations.
 */
export const oracleCheckResultSchema = z.strictObject({
  check_type: z.literal("ORACLE"),
  status: z.enum(["PASS", "PARTIAL", "FAIL"]),
  pattern_match_count: z.number().int().nonnegative(),
  pattern_total_count: z.number().int().positive(),
  evidence_match_count: z.number().int().nonnegative(),
  evidence_total_count: z.number().int().positive(),
  closure_verdict: z.enum(["PASS", "HOLD", "REFUSE"]),
  details: z
    .array(
      z.strictObject({
        pattern_id: z.string().min(1).max(128),
        status: z.enum(["PASS", "PARTIAL", "FAIL", "SKIP"]),
        message: z.string().min(1).max(1024),
      }),
    )
    .min(1),
});
export type OracleCheckResult = z.infer<typeof oracleCheckResultSchema>;

/**
 * Mutation check result schema.
 * Evaluates whether the oracle can detect controlled mutations.
 */
export const mutationCheckResultSchema = z.strictObject({
  check_type: z.literal("MUTATION"),
  status: z.enum(["PASS", "PARTIAL", "FAIL"]),
  mutation_count: z.number().int().positive(),
  detected_count: z.number().int().nonnegative(),
  undetected_count: z.number().int().nonnegative(),
  detection_rate: z.number().min(0).max(1),
  details: z.array(
    z.strictObject({
      mutation_id: z.string().min(1).max(128),
      mutation_type: z.string().min(1).max(64),
      expected_response: z.enum(["PASS", "HOLD", "REFUSE"]),
      actual_response: z.enum(["PASS", "HOLD", "REFUSE"]),
      status: z.enum(["PASS", "FAIL"]),
      message: z.string().min(1).max(1024),
    }),
  ),
});
export type MutationCheckResult = z.infer<typeof mutationCheckResultSchema>;

/**
 * Holdout check result schema.
 * Evaluates whether the system can handle holdout data.
 */
export const holdoutCheckResultSchema = z.strictObject({
  check_type: z.literal("HOLDOUT"),
  status: z.enum(["PASS", "PARTIAL", "FAIL", "SKIP"]),
  holdout_count: z.number().int().nonnegative(),
  holdout_pass_count: z.number().int().nonnegative(),
  holdout_fail_count: z.number().int().nonnegative(),
  details: z.array(
    z.strictObject({
      dataset_id: z.string().min(1).max(256),
      split: z.enum(["DEMO", "HOLDOUT"]),
      status: z.enum(["PASS", "FAIL", "SKIP"]),
      message: z.string().min(1).max(1024),
    }),
  ),
});
export type HoldoutCheckResult = z.infer<typeof holdoutCheckResultSchema>;

/**
 * U7 Attribution Feasibility Verdict schema.
 *
 * This is the output of the U7 post-Kernel Eval Verdict.
 * It runs independent oracle/mutation/holdout checks on the
 * sealed AttributionKernelEvidence@1 from U13.1, and produces
 * a verdict about the feasibility of the attribution evidence.
 *
 * Key constraint: Must not modify kernel numbers, evidence, or truth contract.
 */
export const attributionFeasibilityVerdictSchema = z.strictObject({
  protocol_version: z.literal("attribution-feasibility-verdict@1"),
  verdict_id: immutableIdSchema,
  kernel_evidence_ref: immutableIdSchema,
  truth_contract_ref: z.string().min(1).max(128),
  verdict: attributionFeasibilityVerdictValueSchema,
  oracle_check: oracleCheckResultSchema,
  mutation_check: mutationCheckResultSchema,
  holdout_check: holdoutCheckResultSchema,
  summary: z.string().min(1).max(4096),
  reason_codes: z.array(z.string().min(1)).min(1),
  evaluated_at: timestampSchema,
  evaluator_version: versionIdentifierSchema,
  verdict_hash: contentHashSchema,
});
export type AttributionFeasibilityVerdict = z.infer<typeof attributionFeasibilityVerdictSchema>;

export function computeVerdictHash(input: {
  verdict: AttributionFeasibilityVerdictValue;
  oracle_check: OracleCheckResult;
  mutation_check: MutationCheckResult;
  holdout_check: HoldoutCheckResult;
}): `sha256:${string}` {
  const concatenated = [
    input.verdict,
    input.oracle_check.status,
    input.mutation_check.status,
    input.holdout_check.status,
  ].join("|");
  const hash = crypto.createHash("sha256").update(concatenated, "utf-8").digest("hex");
  return `sha256:${hash}` as `sha256:${string}`;
}

export function determineAttributionFeasibilityVerdict(
  kernelEvidenceRef: string,
  truthContractRef: string,
  oracleCheck: OracleCheckResult,
  mutationCheck: MutationCheckResult,
  holdoutCheck: HoldoutCheckResult,
): AttributionFeasibilityVerdict {
  // Determine verdict based on checks
  let verdict: AttributionFeasibilityVerdictValue;
  const reasonCodes: string[] = [];

  if (oracleCheck.status === "FAIL") {
    verdict = "STOP";
    reasonCodes.push("ORACLE_CHECK_FAILED");
  } else if (mutationCheck.status === "FAIL") {
    verdict = "STOP";
    reasonCodes.push("MUTATION_CHECK_FAILED");
  } else if (oracleCheck.status === "PARTIAL" && holdoutCheck.status === "FAIL") {
    verdict = "STOP";
    reasonCodes.push("ORACLE_PARTIAL_AND_HOLDOUT_FAILED");
  } else if (oracleCheck.status === "PARTIAL") {
    verdict = "NARROW_SCOPE";
    reasonCodes.push("ORACLE_CHECK_PARTIAL");
    if (mutationCheck.status === "PARTIAL") {
      reasonCodes.push("MUTATION_CHECK_PARTIAL");
    }
  } else if (mutationCheck.status === "PARTIAL") {
    verdict = "NARROW_SCOPE";
    reasonCodes.push("MUTATION_CHECK_PARTIAL");
  } else if (holdoutCheck.status === "FAIL") {
    verdict = "EXPAND_IR";
    reasonCodes.push("HOLDOUT_CHECK_FAILED");
  } else if (holdoutCheck.status === "PARTIAL") {
    verdict = "EXPAND_IR";
    reasonCodes.push("HOLDOUT_CHECK_PARTIAL");
  } else {
    verdict = "FEASIBLE_FOR_PUBLISHED_INTEGRATION";
    reasonCodes.push("ALL_CHECKS_PASSED");
  }

  // Build summary
  const summary = [
    `Oracle check: ${oracleCheck.status} (${oracleCheck.pattern_match_count}/${oracleCheck.pattern_total_count} patterns matched)`,
    `Mutation check: ${mutationCheck.status} (${mutationCheck.detection_rate * 100}% detection rate)`,
    `Holdout check: ${holdoutCheck.status} (${holdoutCheck.holdout_pass_count}/${holdoutCheck.holdout_count} holdouts passed)`,
    `Verdict: ${verdict}`,
  ].join(". ");

  const verdictHash = computeVerdictHash({
    verdict,
    oracle_check: oracleCheck,
    mutation_check: mutationCheck,
    holdout_check: holdoutCheck,
  });

  return {
    protocol_version: "attribution-feasibility-verdict@1",
    verdict_id: crypto.randomUUID(),
    kernel_evidence_ref: kernelEvidenceRef,
    truth_contract_ref: truthContractRef,
    verdict,
    oracle_check: oracleCheck,
    mutation_check: mutationCheck,
    holdout_check: holdoutCheck,
    summary,
    reason_codes: reasonCodes,
    evaluated_at: new Date().toISOString() as unknown as string,
    evaluator_version: "attribution-feasibility-evaluator@1",
    verdict_hash: verdictHash,
  };
}
