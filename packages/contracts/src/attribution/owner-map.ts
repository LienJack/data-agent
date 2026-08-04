import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const ATTRIBUTION_OWNER_MAP_VERSION = "attribution-owner-map@1" as const;

/**
 * Owner map entry: maps a canonical path to an owner capability.
 */
export const ownerMapEntrySchema = z.strictObject({
  canonical_path: z.string().min(1).max(1024),
  owner_capability: z.string().min(1).max(256),
  required_signer_roles: z.array(z.string().min(1).max(128)).default([]),
  quorum: z.number().int().min(1).max(100).default(1),
  proof_verifier_roles: z.array(z.string().min(1).max(128)).default([]),
  delegation_config: z
    .object({
      allow_subdelegation: z.boolean().default(false),
      max_delegation_depth: z.number().int().min(1).max(10).optional(),
      delegation_ttl_seconds: z.number().int().min(60).max(86400).optional(),
    })
    .optional(),
});

export type OwnerMapEntry = z.infer<typeof ownerMapEntrySchema>;

/**
 * Attribution owner map release: PROVISIONED → ACTIVE → SUPERSEDED | RETIRED.
 */
export const attributionOwnerMapReleaseSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  release_id: immutableIdSchema,
  owner_map: z.array(ownerMapEntrySchema).min(1),
  status: z.enum(["PROVISIONED", "ACTIVE", "SUPERSEDED", "RETIRED"]),
  created_at: timestampSchema,
  superseded_at: timestampSchema.optional(),
});

export type AttributionOwnerMapRelease = z.infer<typeof attributionOwnerMapReleaseSchema>;
