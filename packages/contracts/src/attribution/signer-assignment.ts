import { z } from "zod";
import { environmentSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const ATTRIBUTION_SIGNER_ASSIGNMENT_VERSION = "attribution-signer-assignment@1" as const;

/**
 * Signer assignment: defines signer roles, quorum, proof-verifier roles,
 * and delegation configuration for a given policy.
 */
export const signerAssignmentSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  assignment_id: immutableIdSchema,
  policy_id: immutableIdSchema,
  signer_role: z.string().min(1).max(128),
  required_signers: z.number().int().min(1).max(1000),
  proof_verifier_roles: z.array(z.string().min(1).max(128)).default([]),
  delegation_config: z
    .object({
      allow_subdelegation: z.boolean().default(false),
      max_delegation_depth: z.number().int().min(1).max(10).optional(),
      delegation_ttl_seconds: z.number().int().min(60).max(86400).optional(),
    })
    .optional(),
  status: z.enum(["PROVISIONED", "ACTIVE", "SUPERSEDED", "RETIRED"]),
  created_at: timestampSchema,
  superseded_at: timestampSchema.optional(),
});

export type SignerAssignment = z.infer<typeof signerAssignmentSchema>;
