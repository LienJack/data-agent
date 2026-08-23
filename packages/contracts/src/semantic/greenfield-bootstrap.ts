import { z } from "zod";
import { platformCapabilityIdSchema } from "../capabilities/platform-capabilities.js";
import {
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  FALCON_DATABASE_COUNT,
  FALCON_SOURCE_COMMIT,
  falconRegistrySchema,
  falconSchemaNameSchema,
} from "../evals/falcon.js";

export const FALCON_BOOTSTRAP_SOURCE_DIGEST =
  "sha256:20ad41ba54d24f70d69a981907ed223ccd7bc6ab0a5894f8e417c567c1d5df4e" as const;

const stableSourceIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

export const greenfieldWorkspaceAssertionSchema = z.strictObject({
  workspace_id: immutableIdSchema,
  purpose: z.enum(["JOURNEY", "FALCON_EVALUATION"]),
  active_release: z.null(),
  generation: z.literal(0),
  existing_run_count: z.literal(0),
  existing_file_count: z.literal(0),
  existing_payload_count: z.literal(0),
});

export const bootstrapSchemaSnapshotSchema = z.strictObject({
  snapshot_id: immutableIdSchema,
  snapshot_content_hash: contentHashSchema,
  datasource_id: stableSourceIdentifierSchema,
});

export const businessSourceDocumentSchema = z.strictObject({
  source_id: immutableIdSchema,
  content_hash: contentHashSchema,
  media_type: z.enum([
    "text/plain",
    "text/markdown",
    "application/json",
    "application/pdf",
    "text/csv",
  ]),
});

export const businessSourceBundleSchema = z
  .strictObject({
    bundle_version: versionIdentifierSchema,
    bundle_hash: contentHashSchema,
    sources: z.array(businessSourceDocumentSchema).min(1).max(10_000),
  })
  .superRefine((bundle, ctx) => {
    const ids = new Set(bundle.sources.map((source) => source.source_id));
    if (ids.size !== bundle.sources.length) {
      ctx.addIssue({ code: "custom", message: "Business Source ID 必须唯一。", path: ["sources"] });
    }
  });

export const bootstrapPolicyReferenceSchema = z.strictObject({
  policy_id: immutableIdSchema,
  policy_version: versionIdentifierSchema,
  policy_hash: contentHashSchema,
  semantic_coverage_floor_version: z.literal("semantic-coverage-floor@1.0.0"),
});

export const mandatoryReleaseManifestSchema = z
  .strictObject({
    manifest_id: immutableIdSchema,
    manifest_hash: contentHashSchema,
    required_capability_ids: z.array(platformCapabilityIdSchema).min(1).max(58),
  })
  .superRefine((manifest, ctx) => {
    if (
      new Set(manifest.required_capability_ids).size !== manifest.required_capability_ids.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Mandatory Release Capability ID 必须唯一。",
        path: ["required_capability_ids"],
      });
    }
  });

export const initialReleaseTargetSchema = z.strictObject({
  release_set_id: immutableIdSchema,
  generation: z.literal(1),
  base_release: z.null(),
  release_label: versionIdentifierSchema,
});

export const falconBootstrapCorpusSchema = z
  .strictObject({
    boundary: z.literal("FALCON_BOOTSTRAP_CORPUS"),
    source_commit: z.literal(FALCON_SOURCE_COMMIT),
    corpus_hash: z.literal(FALCON_BOOTSTRAP_SOURCE_DIGEST),
    database_ids: z.array(falconSchemaNameSchema).length(FALCON_DATABASE_COUNT),
  })
  .superRefine((corpus, ctx) => {
    if (new Set(corpus.database_ids).size !== corpus.database_ids.length) {
      ctx.addIssue({ code: "custom", message: "Falcon Bootstrap database_id 必须唯一。" });
    }
  });

export const journeyBootstrapSourcesSchema = z.strictObject({
  boundary: z.literal("JOURNEY_BOOTSTRAP_SOURCES"),
  source_bundle_hash: contentHashSchema,
});

export const falconPublicCaseInputSchema = z.strictObject({
  boundary: z.literal("FALCON_PUBLIC_CASE"),
  case_id: stableSourceIdentifierSchema,
  database_id: falconSchemaNameSchema,
  registry: falconRegistrySchema,
  question: z.string().trim().min(1).max(20_000),
});

export const falconSealedOracleInputSchema = z.strictObject({
  boundary: z.literal("FALCON_SEALED_ORACLE"),
  case_id: stableSourceIdentifierSchema,
  database_id: falconSchemaNameSchema,
  registry: falconRegistrySchema,
  oracle_material_hash: contentHashSchema,
  oracle_policy_version: versionIdentifierSchema,
});

export const falconInputBoundarySchema = z.discriminatedUnion("boundary", [
  falconBootstrapCorpusSchema,
  falconPublicCaseInputSchema,
  falconSealedOracleInputSchema,
]);

export const semanticGenerationInputSchema = z.discriminatedUnion("boundary", [
  journeyBootstrapSourcesSchema,
  falconBootstrapCorpusSchema,
]);

export const greenfieldBootstrapInputSchema = z
  .strictObject({
    schema_version: z.literal("greenfield-bootstrap-input@1.0.0"),
    workspace: greenfieldWorkspaceAssertionSchema,
    schema_snapshot: bootstrapSchemaSnapshotSchema,
    business_source_bundle: businessSourceBundleSchema,
    bootstrap_policy: bootstrapPolicyReferenceSchema,
    mandatory_release_manifest: mandatoryReleaseManifestSchema,
    initial_release_target: initialReleaseTargetSchema,
    semantic_generation_input: semanticGenerationInputSchema,
  })
  .superRefine((input, ctx) => {
    const expectedBoundary =
      input.workspace.purpose === "FALCON_EVALUATION"
        ? "FALCON_BOOTSTRAP_CORPUS"
        : "JOURNEY_BOOTSTRAP_SOURCES";
    if (input.semantic_generation_input.boundary !== expectedBoundary) {
      ctx.addIssue({
        code: "custom",
        message: "Workspace purpose 与 Semantic Generation 输入边界不一致。",
        path: ["semantic_generation_input", "boundary"],
      });
    }
    if (
      input.semantic_generation_input.boundary === "JOURNEY_BOOTSTRAP_SOURCES" &&
      input.semantic_generation_input.source_bundle_hash !==
        input.business_source_bundle.bundle_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Journey Semantic Generation 必须绑定当前 Business Source Bundle hash。",
        path: ["semantic_generation_input", "source_bundle_hash"],
      });
    }
  });

export async function computeBusinessSourceBundleHash(input: unknown) {
  const bundle = businessSourceBundleSchema.parse(input);
  const { bundle_hash: _bundleHash, ...canonicalFacts } = bundle;
  return sha256ContentHash(canonicalFacts);
}

export async function computeMandatoryReleaseManifestHash(input: unknown) {
  const manifest = mandatoryReleaseManifestSchema.parse(input);
  const { manifest_hash: _manifestHash, ...canonicalFacts } = manifest;
  return sha256ContentHash(canonicalFacts);
}

export class GreenfieldBootstrapCandidateError extends Error {
  override readonly name = "GreenfieldBootstrapCandidateError";
  readonly code = "GREENFIELD_BOOTSTRAP_INPUT_NOT_CONTENT_ADDRESSED";
}

/**
 * Builds a strict, content-addressed candidate descriptor. The workspace's
 * generation-zero/empty fields remain caller assertions here; U5 must verify
 * them against PostgreSQL inside the activation transaction before authority
 * is granted.
 */
export async function buildContentAddressedGreenfieldBootstrapCandidate(
  input: unknown,
): Promise<GreenfieldBootstrapCandidate> {
  const parsed = greenfieldBootstrapInputSchema.parse(input);
  if (
    (await computeBusinessSourceBundleHash(parsed.business_source_bundle)) !==
    parsed.business_source_bundle.bundle_hash
  ) {
    throw new GreenfieldBootstrapCandidateError(
      "Business Source Bundle hash 与 canonical bytes 不匹配。",
    );
  }
  if (
    (await computeMandatoryReleaseManifestHash(parsed.mandatory_release_manifest)) !==
    parsed.mandatory_release_manifest.manifest_hash
  ) {
    throw new GreenfieldBootstrapCandidateError(
      "Mandatory Release Manifest hash 与 canonical bytes 不匹配。",
    );
  }
  return deepFreeze(parsed);
}

export type GreenfieldWorkspaceAssertion = z.infer<typeof greenfieldWorkspaceAssertionSchema>;
export type GreenfieldBootstrapInput = z.infer<typeof greenfieldBootstrapInputSchema>;
export type GreenfieldBootstrapCandidate = z.infer<typeof greenfieldBootstrapInputSchema>;
export type FalconBootstrapCorpus = z.infer<typeof falconBootstrapCorpusSchema>;
export type FalconPublicCaseInput = z.infer<typeof falconPublicCaseInputSchema>;
export type FalconSealedOracleInput = z.infer<typeof falconSealedOracleInputSchema>;
export type FalconInputBoundary = z.infer<typeof falconInputBoundarySchema>;
