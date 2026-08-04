import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const ATTRIBUTION_CAPABILITY_VERSION = "attribution-capability@1" as const;

/**
 * Attribution capability directory: lists available attribution capabilities
 * with anti-enumeration protections.
 */
export const attributionCapabilityDirectorySchema = z.strictObject({
  directory_id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  capabilities: z.array(
    z.object({
      capability_id: immutableIdSchema,
      capability_name: z.string().min(1).max(128),
      capability_type: z.enum([
        "OWNER_MAP",
        "RELATIONSHIP_PROMOTION",
        "CONCLUSION_POLICY",
        "SIGNER_ASSIGNMENT",
        "VERIFICATION_KEY",
        "NONCE_LEDGER",
        "ACTIVE_POINTER",
        "EVIDENCE_KERNEL",
        "PROFILE_PROJECTION",
        "CONCLUSION_AUTHORITY",
        "ELIGIBILITY",
      ]),
      is_available: z.boolean(),
      min_required_role: z.string().min(1).max(128),
      version: z.string().min(1).max(64),
      description: z.string().max(1024).optional(),
      anti_enumeration_hash: contentHashSchema.optional(),
    }),
  ),
  published_at: timestampSchema,
  directory_hash: contentHashSchema,
});

export type AttributionCapabilityDirectory = z.infer<typeof attributionCapabilityDirectorySchema>;

/**
 * Attribution eligibility decision: determines if a request is eligible
 * for attribution processing (frozen-question).
 */
export const attributionEligibilityDecisionSchema = z.strictObject({
  decision_id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  request_id: immutableIdSchema,
  subject_id: z.string().min(1).max(256),
  eligibility_criteria: z.array(
    z.object({
      criterion_id: z.string().min(1).max(128),
      criterion_name: z.string().min(1).max(256),
      is_satisfied: z.boolean(),
      reason: z.string().max(1024).optional(),
    }),
  ),
  overall_eligible: z.boolean(),
  decision: z.enum(["ELIGIBLE", "INELIGIBLE", "DEFERRED"]),
  decided_by: z.string().min(1).max(256),
  decided_at: timestampSchema,
  expires_at: timestampSchema.optional(),
  frozen_question_hash: contentHashSchema,
});

export type AttributionEligibilityDecision = z.infer<typeof attributionEligibilityDecisionSchema>;
