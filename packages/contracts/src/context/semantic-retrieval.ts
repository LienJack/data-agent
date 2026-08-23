import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { analysisCapabilitySchema } from "../artifacts/semantic-governance.js";
import { resolvedContextPackageSchema } from "./resolved-context-package.js";

export const SEMANTIC_RETRIEVAL_RECEIPT_VERSION =
  "semantic-retrieval-receipt@1.0.0" as const;
export const SEMANTIC_INFERENCE_RECEIPT_VERSION =
  "semantic-inference-receipt@1.0.0" as const;
export const RESOLVED_CONTEXT_PACKAGE_V3_VERSION = "resolved-context-package@3.0.0" as const;

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

const resolvedContextPackageV3MaterialSchema = z
  .strictObject({
    schema_version: z.literal(RESOLVED_CONTEXT_PACKAGE_V3_VERSION),
    base_package: resolvedContextPackageSchema,
    retrieval_receipt: semanticRetrievalReceiptSchema,
    inference_receipt: semanticInferenceReceiptSchema,
    mandatory_closure: z.strictObject({
      object_ids: z.array(versionIdentifierSchema).max(80),
      relationship_ids: z.array(versionIdentifierSchema).max(160),
      closure_hash: contentHashSchema,
    }),
    analysis_capabilities: z.array(analysisCapabilitySchema).max(32),
  })
  .superRefine((document, context) => {
    if (
      document.base_package.authority_snapshot_hash !==
        document.retrieval_receipt.authority_snapshot_hash ||
      document.base_package.semantic_release.resource_hash !==
        document.retrieval_receipt.release_hash ||
      document.base_package.question_hash !== document.retrieval_receipt.query_hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Retrieval receipt must bind the exact V2 authority package.",
        path: ["retrieval_receipt"],
      });
    }
    if (
      document.inference_receipt.retrieval_receipt_hash !==
      document.retrieval_receipt.receipt_hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Inference receipt must bind the exact retrieval receipt.",
        path: ["inference_receipt", "retrieval_receipt_hash"],
      });
    }
    if (!document.inference_receipt.closure_complete) {
      context.addIssue({
        code: "custom",
        message: "RCP V3 cannot carry an incomplete mandatory closure.",
        path: ["inference_receipt", "closure_complete"],
      });
    }
  });

export const resolvedContextPackageV3Schema = resolvedContextPackageV3MaterialSchema.extend({
  package_hash: contentHashSchema,
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

export async function buildResolvedContextPackageV3(input: unknown) {
  const full = resolvedContextPackageV3Schema.safeParse(input);
  const material = full.success
    ? resolvedContextPackageV3MaterialSchema.parse(
        Object.fromEntries(Object.entries(full.data).filter(([key]) => key !== "package_hash")),
      )
    : resolvedContextPackageV3MaterialSchema.parse(input);
  return deepFreeze(
    resolvedContextPackageV3Schema.parse({
      ...material,
      package_hash: await sha256ContentHash(material),
    }),
  );
}

export async function verifyResolvedContextPackageV3(input: unknown) {
  const document = resolvedContextPackageV3Schema.parse(input);
  const { package_hash: _packageHash, ...material } = document;
  if (
    (await sha256ContentHash(material)) !== document.package_hash ||
    (await sha256ContentHash(
      Object.fromEntries(
        Object.entries(document.retrieval_receipt).filter(([key]) => key !== "receipt_hash"),
      ),
    )) !== document.retrieval_receipt.receipt_hash ||
    (await sha256ContentHash(
      Object.fromEntries(
        Object.entries(document.inference_receipt).filter(([key]) => key !== "receipt_hash"),
      ),
    )) !== document.inference_receipt.receipt_hash
  ) {
    throw new TypeError("RESOLVED_CONTEXT_PACKAGE_V3_HASH_MISMATCH");
  }
  return document;
}

export type SemanticRetrievalRoute = z.infer<typeof semanticRetrievalRouteSchema>;
export type SemanticRetrievalHit = z.infer<typeof semanticRetrievalHitSchema>;
export type SemanticGraphExpansion = z.infer<typeof semanticGraphExpansionSchema>;
export type SemanticRetrievalReceipt = z.infer<typeof semanticRetrievalReceiptSchema>;
export type SemanticInferenceStep = z.infer<typeof semanticInferenceStepSchema>;
export type SemanticInferenceReceipt = z.infer<typeof semanticInferenceReceiptSchema>;
export type ResolvedContextPackageV3 = z.infer<typeof resolvedContextPackageV3Schema>;
