import { z } from "zod";
import {
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const ATTRIBUTION_NONCE_VERSION = "attribution-nonce@1" as const;

/**
 * Nonce ledger entry: stores nonce entries for atomic check-and-consume
 * operations to prevent replay attacks.
 */
export const nonceLedgerEntrySchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  nonce: z.string().min(1).max(256),
  purpose: z.string().min(1).max(128),
  consumed_at: timestampSchema,
  expires_at: timestampSchema,
  origin: z.string().max(256).optional(),
});

export type NonceLedgerEntry = z.infer<typeof nonceLedgerEntrySchema>;
