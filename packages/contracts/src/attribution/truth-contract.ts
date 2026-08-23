import { z } from "zod";
import { timestampSchema } from "../common/index.js";

export const ATTRIBUTION_TRUTH_CONTRACT_VERSION = "attribution-truth-contract@1" as const;

/**
 * Contribution truth contract: defines the ground truth for attribution testing.
 * Used by the U13.1 fixture kernel to produce sealed AttributionKernelEvidence.
 */
export const contributionTruthContractSchema = z.strictObject({
  contract_version: z.literal("attribution-truth-contract@1"),
  truth_id: z.string().min(1).max(128),
  truth_name: z.string().min(1).max(256),
  description: z.string().min(1).max(2048),
  fixture_identity: z.object({
    fixture_id: z.string().min(1).max(256),
    fixture_version: z.string().min(1).max(64),
    fixture_origin: z.literal("FIXTURE"),
  }),
  contribution_patterns: z
    .array(
      z.object({
        pattern_id: z.string().min(1).max(128),
        pattern_name: z.string().min(1).max(256),
        source_identity: z.string().min(1).max(256),
        expected_verdict: z.enum(["CONFIRMED", "REJECTED", "INCONCLUSIVE"]),
        evidence_requirements: z.array(
          z.object({
            required_link_type: z.string().min(1).max(64),
            required_link_ref_pattern: z.string().min(1).max(512),
            min_confidence: z.number().min(0).max(1).default(0.0),
          }),
        ),
        truth_metadata: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1),
  created_at: timestampSchema,
  expires_at: timestampSchema.optional(),
});

export type ContributionTruthContract = z.infer<typeof contributionTruthContractSchema>;

/**
 * Fixture conclusion candidate: the raw output of the U13.1 fixture kernel
 * before sealing into AttributionKernelEvidence.
 */
export const fixtureConclusionCandidateSchema = z.strictObject({
  candidate_id: z.string().min(1).max(128),
  subject_id: z.string().min(1).max(256),
  source_identity: z.string().min(1).max(256),
  contribution_verdict: z.enum(["CONFIRMED", "REJECTED", "INCONCLUSIVE"]),
  evidence_links: z.array(
    z.object({
      link_type: z.string().min(1).max(64),
      link_hash: z.string().min(1).max(128),
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
});

export type FixtureConclusionCandidate = z.infer<typeof fixtureConclusionCandidateSchema>;
