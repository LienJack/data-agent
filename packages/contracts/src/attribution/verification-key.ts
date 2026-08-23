import { z } from "zod";
import { environmentSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const ATTRIBUTION_VERIFICATION_KEY_VERSION = "attribution-verification-key@1" as const;

/**
 * Verification key trust root: marks a key as a trust anchor.
 */
export const verificationKeyTrustRootSchema = z.strictObject({
  key_id: immutableIdSchema,
  is_trust_root: z.literal(true),
  trust_root_established_at: timestampSchema,
  established_by: z.string().min(1).max(256),
});

export type VerificationKeyTrustRoot = z.infer<typeof verificationKeyTrustRootSchema>;

/**
 * Verification key revision: lifecycle STAGED → ACTIVE → COMPROMISED | RETIRED.
 */
export const verificationKeyRevisionSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  key_id: immutableIdSchema,
  key_algorithm: z.string().min(1).max(64),
  public_key: z.string().min(1).max(8192),
  trust_root: z.boolean().default(false),
  status: z.enum(["STAGED", "ACTIVE", "COMPROMISED", "RETIRED"]),
  created_at: timestampSchema,
  superseded_at: timestampSchema.optional(),
});

export type VerificationKeyRevision = z.infer<typeof verificationKeyRevisionSchema>;
