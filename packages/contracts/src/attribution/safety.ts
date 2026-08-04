import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const ATTRIBUTION_SAFETY_VERSION = "attribution-safety@1" as const;

/**
 * Published attribution safety verdict: GO / HOLD / STOP decision
 * for published attribution results.
 */
export const publishedAttributionSafetyVerdictSchema = z.strictObject({
  verdict_id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  run_id: immutableIdSchema,
  evidence_id: immutableIdSchema,
  verdict: z.enum(["GO", "HOLD", "STOP"]),
  verdict_reason: z.string().min(1).max(2048),
  verdict_dimensions: z.array(
    z.object({
      dimension_name: z.string().min(1).max(128),
      dimension_result: z.enum(["PASS", "WARN", "FAIL", "SKIP"]),
      dimension_details: z.string().max(1024).optional(),
      dimension_score: z.number().min(0).max(1).optional(),
    }),
  ),
  determined_by: z.string().min(1).max(256),
  determined_at: timestampSchema,
  evidence_hash: contentHashSchema,
  supersedes_verdict_id: immutableIdSchema.optional(),
  auto_approve: z.boolean().default(false),
  ttl_seconds: z.number().int().min(60).max(86400 * 30).default(3600),
});

export type PublishedAttributionSafetyVerdict = z.infer<
  typeof publishedAttributionSafetyVerdictSchema
>;
