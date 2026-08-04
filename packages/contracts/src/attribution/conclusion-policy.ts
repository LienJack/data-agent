import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const ATTRIBUTION_CONCLUSION_POLICY_VERSION = "attribution-conclusion-policy@1" as const;

/**
 * Conclusion policy decision envelope: defines the rules for
 * issuing conclusion signatures.
 */
export const conclusionPolicyDecisionEnvelopeSchema = z.strictObject({
  algorithm_policy: z.object({
    allowed_algorithms: z.array(z.string().min(1).max(64)).min(1),
    min_key_length: z.number().int().min(256).max(16384).default(2048),
    hash_algorithm: z.string().min(1).max(32).default("SHA256"),
  }),
  signer_requirements: z.object({
    min_signers: z.number().int().min(1).max(100).default(1),
    allowed_signer_roles: z.array(z.string().min(1).max(128)).min(1),
    require_physical_presence: z.boolean().default(false),
    signature_ttl_seconds: z.number().int().min(60).max(86400).default(3600),
  }),
  verification_constraints: z.object({
    allow_trust_root_only: z.boolean().default(false),
    required_trust_chain_depth: z.number().int().min(0).max(10).default(0),
    verify_against_revocation_list: z.boolean().default(true),
  }),
});

export type ConclusionPolicyDecisionEnvelope = z.infer<typeof conclusionPolicyDecisionEnvelopeSchema>;

/**
 * Conclusion policy release: PROVISIONED → ACTIVE → SUPERSEDED | RETIRED.
 */
export const conclusionPolicyReleaseSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  policy_id: immutableIdSchema,
  policy: conclusionPolicyDecisionEnvelopeSchema,
  status: z.enum(["PROVISIONED", "ACTIVE", "SUPERSEDED", "RETIRED"]),
  created_at: timestampSchema,
  superseded_at: timestampSchema.optional(),
});

export type ConclusionPolicyRelease = z.infer<typeof conclusionPolicyReleaseSchema>;
