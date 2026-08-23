import { z } from "zod";
import type { PortResult } from "../common/index.js";
import {
  embeddingProfileReferenceSchema,
  knowledgeDataProjectionReceiptSchema,
  knowledgeQueryProjectionReceiptSchema,
} from "../knowledge/knowledge-base.js";

export const embeddingRequestSchema = z.strictObject({
  schema_version: z.literal("embedding-request@1.0.0"),
  profile_ref: embeddingProfileReferenceSchema,
  provider: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  model_id: z.string().min(1).max(128),
  dimensions: z.number().int().min(2).max(16_384),
  projection_receipt: z.union([
    knowledgeDataProjectionReceiptSchema,
    knowledgeQueryProjectionReceiptSchema,
  ]),
  projected_text: z.string().min(1).max(32_000),
});

export const embeddingResultSchema = z.strictObject({
  schema_version: z.literal("embedding-result@1.0.0"),
  provider: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  model_id: z.string().min(1).max(128),
  dimensions: z.number().int().min(2).max(16_384),
  vector: z.array(z.number().finite()).min(2).max(16_384),
});

export interface EmbeddingProviderPort {
  embed(input: EmbeddingRequest, signal: AbortSignal): Promise<PortResult<EmbeddingResult>>;
}

export type EmbeddingRequest = z.infer<typeof embeddingRequestSchema>;
export type EmbeddingResult = z.infer<typeof embeddingResultSchema>;
