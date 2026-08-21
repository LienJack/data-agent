import { z } from "zod";
import { agentSpecialistProfileIdSchema } from "../agents/profile-registry.js";
import {
  canonicalizeJson,
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

const productTeamArtifactDraftSchema = z
  .strictObject({
    schema_version: z.literal("product-team-artifact@1.0.0"),
    artifact_ref: productArtifactReferenceSchema,
    profile_id: agentSpecialistProfileIdSchema,
    task_id: immutableIdSchema,
    source_refs: z.array(artifactReferenceSchema).max(16),
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
