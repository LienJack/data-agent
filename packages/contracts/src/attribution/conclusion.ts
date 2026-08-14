import { z } from "zod";
import { contentHashSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const ATTRIBUTION_CONCLUSION_VERSION = "attribution-conclusion@1" as const;

/**
 * Conclusion subject manifest: identifies the subject of a conclusion.
 */
export const conclusionSubjectManifestSchema = z.strictObject({
  subject_id: z.string().min(1).max(256),
  subject_type: z.enum(["CONTRIBUTION", "ENDPOINT", "PROFILE", "EVIDENCE", "AGGREGATE"]),
  subject_version: z.string().min(1).max(64),
  subject_hash: contentHashSchema,
  reference_chain: z.array(
    z.object({
      ref_type: z.string().min(1).max(64),
      ref_id: immutableIdSchema,
      ref_hash: contentHashSchema,
    }),
  ),
});

export type ConclusionSubjectManifest = z.infer<typeof conclusionSubjectManifestSchema>;

/**
 * Conclusion receipt subject: a receipt that records a conclusion
 * was issued for a specific subject.
 */
export const conclusionReceiptSubjectSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  subject_manifest: conclusionSubjectManifestSchema,
  conclusion_verdict: z.enum(["APPROVED", "REJECTED", "ABSTAINED", "ESCALATED"]),
  conclusion_reason: z.string().min(1).max(2048),
  concluded_by: z.string().min(1).max(256),
  concluded_at: timestampSchema,
  signature: z.string().min(1).max(4096).optional(),
  witness_signatures: z.array(z.string().min(1).max(4096)).default([]),
});

export type ConclusionReceiptSubject = z.infer<typeof conclusionReceiptSubjectSchema>;

/**
 * Conclusion signature authority: the authority that issues conclusion signatures.
 */
export const conclusionSignatureAuthoritySchema = z.strictObject({
  authority_id: immutableIdSchema,
  authority_name: z.string().min(1).max(256),
  authority_public_key: z.string().min(1).max(4096),
  key_algorithm: z.string().min(1).max(64),
  authority_role: z.enum(["PRIMARY", "BACKUP", "WITNESS"]),
  is_active: z.boolean().default(true),
  registered_at: timestampSchema,
  expires_at: timestampSchema.optional(),
  issued_conclusions: z.number().int().min(0).default(0),
});

export type ConclusionSignatureAuthority = z.infer<typeof conclusionSignatureAuthoritySchema>;
