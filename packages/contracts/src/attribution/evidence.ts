import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";
import { attributionFeasibilityVerdictSchema } from "./attribution-feasibility-verdict.js";
import { attributionEligibilityDecisionSchema } from "./capability.js";
import { closureVerdictSchema } from "./contribution-closure-receipt.js";
import { publishedAttributionSafetyVerdictSchema } from "./safety.js";
import { fixtureConclusionCandidateSchema } from "./truth-contract.js";
import { contributionScmCausalTruthSchema } from "./truth-types.js";

export const ATTRIBUTION_KERNEL_EVIDENCE_VERSION = "attribution-kernel-evidence@1" as const;

export const f9StatusSchema = z.strictObject({
  core_l2: z.literal("HOLD"),
  attribution_f9: z.literal("NOT_REGISTERED"),
  fixture_evidence: z.literal("HOLD"),
});
export type F9Status = z.infer<typeof f9StatusSchema>;

export const versionFrontierRefSchema = z.strictObject({
  identity_ref: immutableIdSchema,
  principal_ref: immutableIdSchema,
  scope_ref: immutableIdSchema,
  time_window_ref: immutableIdSchema,
  classification_ref: immutableIdSchema,
});
export type VersionFrontierRef = z.infer<typeof versionFrontierRefSchema>;

/**
 * Attribution kernel evidence: sealed output of the U13.1 fixture kernel.
 * This is the sealed, typed output that the fixture endpoint kernel produces.
 * Extended with U13.1 fields: version frontier refs, endpoint binding refs,
 * lowering certificate refs, budget admission ref, delta observation set ref,
 * closure receipt ref, conclusion candidate, closure verdict, explicit absence,
 * and f9 status.
 */
export const attributionKernelEvidenceSchema = z.strictObject({
  evidence_id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  run_id: immutableIdSchema,
  kernel_version: z.literal("attribution-kernel@1"),
  origin: z.literal("FIXTURE"),
  profile_hash: contentHashSchema,
  contribution_truth_hash: contentHashSchema,
  // U13.1 extended fields
  version_frontier_refs: z.strictObject({
    baseline: versionFrontierRefSchema,
    follow_up: versionFrontierRefSchema,
  }),
  endpoint_binding_refs: z.array(immutableIdSchema).min(1),
  lowering_certificate_refs: z.array(immutableIdSchema).min(1),
  budget_admission_ref: immutableIdSchema,
  delta_observation_set_ref: immutableIdSchema,
  closure_receipt_ref: immutableIdSchema,
  conclusion_candidate: fixtureConclusionCandidateSchema,
  closure_verdict: closureVerdictSchema,
  explicit_absence: z.literal("attribution_feasibility_verdict"),
  f9_status: f9StatusSchema,
  fixture_conclusion: z.object({
    subject_id: z.string().min(1).max(256),
    source_identity: z.string().min(1).max(256),
    contribution_verdict: z.enum(["CONFIRMED", "REJECTED", "INCONCLUSIVE"]),
    evidence_links: z.array(
      z.object({
        link_type: z.string().min(1).max(64),
        link_hash: contentHashSchema,
        link_ref: z.string().min(1).max(1024),
      }),
    ),
    fixture_metadata: z.object({
      fixture_id: z.string().min(1).max(256),
      fixture_version: z.string().min(1).max(64),
      generated_at: timestampSchema,
      fixture_confidence: z.number().min(0).max(1).default(0.5),
    }),
    signed_at: timestampSchema,
  }),
  sealed_at: timestampSchema,
});

export type AttributionKernelEvidence = z.infer<typeof attributionKernelEvidenceSchema>;

export const causalAttributionAuthorityClosureSchema = z
  .strictObject({
    protocol_version: z.literal("causal-attribution-authority-closure@1.0.0"),
    eligibility: attributionEligibilityDecisionSchema,
    safety: publishedAttributionSafetyVerdictSchema,
    feasibility: attributionFeasibilityVerdictSchema,
    scm_truth: contributionScmCausalTruthSchema,
    closure_hash: contentHashSchema,
  })
  .superRefine((closure, ctx) => {
    if (
      closure.eligibility.app_id !== closure.safety.app_id ||
      closure.eligibility.tenant_id !== closure.safety.tenant_id ||
      closure.eligibility.environment !== closure.safety.environment
    ) {
      ctx.addIssue({ code: "custom", message: "Attribution Authority Closure Scope 不一致。" });
    }
    if (
      !closure.eligibility.overall_eligible ||
      closure.eligibility.decision !== "ELIGIBLE" ||
      closure.safety.verdict !== "GO" ||
      closure.safety.auto_approve ||
      closure.feasibility.verdict !== "FEASIBLE_FOR_PUBLISHED_INTEGRATION"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "因果识别必须复用通过 Eligibility/Safety/Feasibility 的 Attribution Authority。",
      });
    }
    if (
      closure.scm_truth.expected_effect === "UNKNOWN" ||
      !closure.scm_truth.directed_edges?.length ||
      !closure.scm_truth.data_generating_process_version
    ) {
      ctx.addIssue({ code: "custom", message: "SCM Truth 必须冻结图、DGP 与已知效应方向。" });
    }
    if (closure.feasibility.kernel_evidence_ref !== closure.safety.evidence_id) {
      ctx.addIssue({
        code: "custom",
        message: "Feasibility 必须消费同一 Safety Evidence identity。",
      });
    }
  });

export type CausalAttributionAuthorityClosure = z.infer<
  typeof causalAttributionAuthorityClosureSchema
>;
