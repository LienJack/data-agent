import { z } from "zod";
import { agentSpecialistProfileIdSchema } from "../agents/profile-registry.js";
import {
  canonicalizeJson,
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import { artifactReferenceFor, artifactReferenceSchema } from "./envelope.js";
import { artifactWorkspaceProjectionSchema } from "./export-receipt.js";

const productArtifactReferenceSchema = z.union([
  artifactReferenceFor("SqlArtifact"),
  artifactReferenceFor("QueryEvidence"),
  artifactReferenceFor("AnalysisReport"),
]);

const productTeamArtifactProvenanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("TEXT2SQL_CANDIDATE"),
    candidate_hash: contentHashSchema,
    parameters_hash: contentHashSchema,
    parameter_count: z.number().int().nonnegative().max(256),
    datasource_ref: z.strictObject({
      resource_id: immutableIdSchema,
      resource_revision: z.number().int().positive().safe(),
      resource_hash: contentHashSchema,
    }),
    schema_snapshot_ref: z.strictObject({
      resource_id: immutableIdSchema,
      resource_hash: contentHashSchema,
    }),
    semantic_context_ref: z.strictObject({
      package_id: immutableIdSchema,
      package_hash: contentHashSchema,
    }),
    target_binding_hash: contentHashSchema,
  }),
  z.strictObject({
    kind: z.literal("GOVERNED_QUERY_RESULT"),
    query_id: immutableIdSchema,
    request_hash: contentHashSchema,
    result_hash: contentHashSchema,
    row_count: z.number().int().nonnegative().safe(),
    byte_count: z.number().int().nonnegative().safe(),
    elapsed_ms: z.number().nonnegative().finite(),
    truncated: z.literal(false),
  }),
]);

const productTeamArtifactDraftSchema = z
  .strictObject({
    schema_version: z.literal("product-team-artifact@2.0.0"),
    artifact_ref: productArtifactReferenceSchema,
    profile_id: agentSpecialistProfileIdSchema,
    task_id: immutableIdSchema,
    source_refs: z.array(artifactReferenceSchema).max(16),
    provenance: productTeamArtifactProvenanceSchema.nullable(),
    projection: artifactWorkspaceProjectionSchema,
    committed_at: timestampSchema,
  })
  .superRefine((document, ctx) => {
    const expectedKind =
      document.artifact_ref.artifact_type === "SqlArtifact"
        ? "SQL"
        : document.artifact_ref.artifact_type === "QueryEvidence"
          ? "TABLE"
          : "REPORT";
    if (document.projection.kind !== expectedKind) {
      ctx.addIssue({
        code: "custom",
        message: "Product Team Artifact type 与安全 Preview projection 不匹配。",
        path: ["projection", "kind"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "SqlArtifact" &&
      (document.provenance?.kind !== "TEXT2SQL_CANDIDATE" || document.source_refs.length !== 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SqlArtifact 必须封存 Text2SQL candidate provenance 且不得伪造上游来源。",
        path: ["provenance"],
      });
    }
    if (
      document.artifact_ref.artifact_type === "QueryEvidence" &&
      (document.provenance?.kind !== "GOVERNED_QUERY_RESULT" ||
        document.source_refs.length !== 1 ||
        document.source_refs[0]?.artifact_type !== "SqlArtifact")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "QueryEvidence 必须封存查询 receipt 并精确引用一个 SqlArtifact。",
        path: ["provenance"],
      });
    }
    if (document.artifact_ref.artifact_type === "AnalysisReport" && document.provenance !== null) {
      ctx.addIssue({
        code: "custom",
        message: "AnalysisReport 的数值来源只由 source_refs 表达。",
        path: ["provenance"],
      });
    }
    for (const [index, reference] of document.source_refs.entries()) {
      if (
        reference.app_id !== document.artifact_ref.app_id ||
        reference.tenant_id !== document.artifact_ref.tenant_id ||
        reference.environment !== document.artifact_ref.environment ||
        reference.run_id !== document.artifact_ref.run_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Product Team Artifact source ref 必须属于同一 Scope/Run。",
          path: ["source_refs", index],
        });
      }
    }
  });

export const productTeamArtifactDocumentSchema = productTeamArtifactDraftSchema;
export type ProductTeamArtifactDocument = z.infer<typeof productTeamArtifactDocumentSchema>;

export async function computeProductTeamArtifactHash(input: unknown) {
  const document = productTeamArtifactDocumentSchema.parse(input);
  const { content_hash: _contentHash, ...reference } = document.artifact_ref;
  return sha256ContentHash({
    schema_version: document.schema_version,
    artifact_ref: reference,
    profile_id: document.profile_id,
    task_id: document.task_id,
    source_refs: document.source_refs,
    provenance: document.provenance,
    projection: document.projection,
    committed_at: document.committed_at,
  });
}

export async function buildProductTeamArtifactDocument(input: unknown) {
  const document = productTeamArtifactDocumentSchema.parse(input);
  return productTeamArtifactDocumentSchema.parse({
    ...document,
    artifact_ref: {
      ...document.artifact_ref,
      content_hash: await computeProductTeamArtifactHash(document),
    },
  });
}

export async function verifyProductTeamArtifactDocument(input: unknown) {
  const document = productTeamArtifactDocumentSchema.parse(input);
  if ((await computeProductTeamArtifactHash(document)) !== document.artifact_ref.content_hash) {
    throw new TypeError("PRODUCT_TEAM_ARTIFACT_HASH_MISMATCH");
  }
  if (new Set(document.source_refs.map(canonicalizeJson)).size !== document.source_refs.length) {
    throw new TypeError("PRODUCT_TEAM_ARTIFACT_SOURCE_DUPLICATE");
  }
  return document;
}
