import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";

export const SEMANTIC_RETRIEVAL_RECEIPT_VERSION = "semantic-retrieval-receipt@1.0.0" as const;
export const SEMANTIC_INFERENCE_RECEIPT_VERSION = "semantic-inference-receipt@1.0.0" as const;

export const semanticRetrievalRouteSchema = z.enum(["LEXICON", "SPARSE", "VECTOR", "GRAPH"]);

export const semanticRetrievalHitSchema = z.strictObject({
  object_id: versionIdentifierSchema,
  object_kind: z.enum(["METRIC", "ONTOLOGY", "RELATIONSHIP", "KNOWLEDGE"]),
  object_hash: contentHashSchema,
  route: semanticRetrievalRouteSchema,
  rank: z.number().int().min(1).max(100_000),
  route_score: z.number().finite().min(0).max(1),
  rrf_score: z.number().finite().positive(),
  matched_text: z.string().trim().min(1).max(512),
});

export const semanticGraphExpansionSchema = z.strictObject({
  relationship_id: versionIdentifierSchema,
  relationship_hash: contentHashSchema,
  relationship_kind: z.string().trim().min(1).max(128),
  source_object_id: versionIdentifierSchema,
  target_object_id: versionIdentifierSchema,
  direction: z.enum(["OUTBOUND", "INBOUND"]),
  hop: z.number().int().min(1).max(3),
  mandatory: z.boolean(),
});

const semanticRetrievalReceiptMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_RETRIEVAL_RECEIPT_VERSION),
  authority_snapshot_hash: contentHashSchema,
  release_hash: contentHashSchema,
  query_hash: contentHashSchema,
  rrf_k: z.literal(60),
  hard_filter: z.strictObject({
    scope_hash: contentHashSchema,
    publication_status: z.literal("PUBLISHED"),
    authority_mode: z.literal("POSTGRES_FILTERED_SNAPSHOT"),
    included_object_ids: z.array(versionIdentifierSchema).max(100_000),
    excluded_objects: z
      .array(
        z.strictObject({
          object_id: versionIdentifierSchema,
          reason_code: z.enum([
            "RBAC_DENIED",
            "NOT_PUBLISHED",
            "OUTSIDE_VALID_TIME",
            "SENSITIVITY_DENIED",
            "UNRESOLVED_CONFLICT",
          ]),
        }),
      )
      .max(100_000),
  }),
  route_states: z.strictObject({
    LEXICON: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
    SPARSE: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
    VECTOR: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
    GRAPH: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
  }),
  hits: z.array(semanticRetrievalHitSchema).max(512),
  expansions: z.array(semanticGraphExpansionSchema).max(160),
  selected_object_ids: z.array(versionIdentifierSchema).max(80),
  pruned_object_ids: z.array(versionIdentifierSchema).max(100_000),
  fallback_reason_codes: z.array(z.string().trim().min(1).max(128)).max(32),
});

export const semanticRetrievalReceiptSchema = semanticRetrievalReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

export const semanticInferenceStepSchema = z.strictObject({
  inference_id: versionIdentifierSchema,
  rule_id: versionIdentifierSchema,
  premise_object_ids: z.array(versionIdentifierSchema).min(1).max(64),
  conclusion_object_ids: z.array(versionIdentifierSchema).min(1).max(64),
  relationship_path_ids: z.array(versionIdentifierSchema).max(64),
  premise_hashes: z.array(contentHashSchema).min(1).max(64),
  release_hash: contentHashSchema,
  valid_time_hash: contentHashSchema,
  mandatory: z.boolean(),
  explanation: z.string().trim().min(1).max(2_048),
});

const semanticInferenceReceiptMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_INFERENCE_RECEIPT_VERSION),
  retrieval_receipt_hash: contentHashSchema,
  ruleset_id: versionIdentifierSchema,
  ruleset_hash: contentHashSchema,
  steps: z.array(semanticInferenceStepSchema).max(512),
  mandatory_object_ids: z.array(versionIdentifierSchema).max(80),
  mandatory_relationship_ids: z.array(versionIdentifierSchema).max(160),
  closure_complete: z.boolean(),
  reason_codes: z.array(z.string().trim().min(1).max(128)).max(64),
});

export const semanticInferenceReceiptSchema = semanticInferenceReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

export async function buildSemanticRetrievalReceipt(input: unknown) {
  const full = semanticRetrievalReceiptSchema.safeParse(input);
  const material = full.success
    ? semanticRetrievalReceiptMaterialSchema.parse(
        Object.fromEntries(Object.entries(full.data).filter(([key]) => key !== "receipt_hash")),
      )
    : semanticRetrievalReceiptMaterialSchema.parse(input);
  return deepFreeze(
    semanticRetrievalReceiptSchema.parse({
      ...material,
      receipt_hash: await sha256ContentHash(material),
    }),
  );
}

export async function buildSemanticInferenceReceipt(input: unknown) {
  const full = semanticInferenceReceiptSchema.safeParse(input);
  const material = full.success
    ? semanticInferenceReceiptMaterialSchema.parse(
        Object.fromEntries(Object.entries(full.data).filter(([key]) => key !== "receipt_hash")),
      )
    : semanticInferenceReceiptMaterialSchema.parse(input);
  return deepFreeze(
    semanticInferenceReceiptSchema.parse({
      ...material,
      receipt_hash: await sha256ContentHash(material),
    }),
  );
}

export type SemanticRetrievalRoute = z.infer<typeof semanticRetrievalRouteSchema>;
export type SemanticRetrievalHit = z.infer<typeof semanticRetrievalHitSchema>;
export type SemanticGraphExpansion = z.infer<typeof semanticGraphExpansionSchema>;
export type SemanticRetrievalReceipt = z.infer<typeof semanticRetrievalReceiptSchema>;
export type SemanticInferenceStep = z.infer<typeof semanticInferenceStepSchema>;
export type SemanticInferenceReceipt = z.infer<typeof semanticInferenceReceiptSchema>;
