import { z } from "zod";
import { environmentSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const ATTRIBUTION_ACTIVE_POINTER_VERSION = "attribution-active-pointer@1" as const;

/**
 * Attribution active pointer: tracks the current active version
 * for each attribution resource type.
 */
export const attributionPointerTypeSchema = z.enum([
  "OWNER_MAP",
  "POLICY",
  "SIGNER_ASSIGNMENT",
  "VERIFICATION_KEY",
]);

export type AttributionPointerType = z.infer<typeof attributionPointerTypeSchema>;

/**
 * Attribution active pointer schema.
 */
export const attributionActivePointerSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  pointer_type: attributionPointerTypeSchema,
  active_id: immutableIdSchema,
  status: z.enum(["ACTIVE", "FROZEN"]).default("ACTIVE"),
  version: z.number().int().min(1).max(2147483647).default(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type AttributionActivePointer = z.infer<typeof attributionActivePointerSchema>;
