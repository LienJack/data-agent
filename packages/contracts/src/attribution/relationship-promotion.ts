import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const ATTRIBUTION_RELATIONSHIP_PROMOTION_VERSION =
  "attribution-relationship-promotion@1" as const;

/**
 * Relationship promotion receipt: tracks promotion of relationships
 * between source releases across the semantic lifecycle.
 */
export const relationshipPromotionReceiptSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  receipt_id: immutableIdSchema,
  source_release_id: immutableIdSchema,
  target_release_id: immutableIdSchema,
  promotion_type: z.enum(["PROMOTE", "DEMOTE", "RECONCILE"]),
  status: z.enum(["COMMITTED", "VERIFIED", "FAILED"]),
  promotion_receipt: z.record(z.string(), z.unknown()).optional(),
  created_at: timestampSchema,
  verified_at: timestampSchema.optional(),
});

export type RelationshipPromotionReceipt = z.infer<typeof relationshipPromotionReceiptSchema>;
