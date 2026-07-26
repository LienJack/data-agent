import { z } from "zod";
import {
  type ArtifactReference,
  type ArtifactReferenceVerifier,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import { knownArtifactTypeSchema } from "../artifacts/types.js";
import {
  contentHashSchema,
  deepFreeze,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

const releaseManifestReferenceSchema = artifactReferenceFor("ReleaseManifest");

export const SYNTHETIC_METAMORPHIC_ARTIFACT_TYPES = [
  "FixtureMutationRecord",
  "MetamorphicFixtureReceipt",
  "MetamorphicOracleReceipt",
] as const;

const productionReleaseEvidenceArtifactTypeSchema = knownArtifactTypeSchema.exclude(
  SYNTHETIC_METAMORPHIC_ARTIFACT_TYPES,
);

export const productionReleaseEvidenceReferenceSchema = artifactReferenceSchema.extend({
  artifact_type: productionReleaseEvidenceArtifactTypeSchema,
});

export const releaseManifestSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    manifest_ref: releaseManifestReferenceSchema,
    release_policy_version: versionIdentifierSchema,
    source_commit: z.string().regex(/^[a-f0-9]{7,64}$/),
    contract_version: versionIdentifierSchema,
    component_versions: z.record(versionIdentifierSchema, versionIdentifierSchema),
    workflow_version: versionIdentifierSchema,
    eval_run_refs: z.array(artifactReferenceFor("EvalRun")).min(1),
    tenancy_evidence_refs: z.array(artifactReferenceSchema).min(1),
    deployment_evidence: z.strictObject({
      hosted_refs: z.array(productionReleaseEvidenceReferenceSchema).min(1),
      docker_refs: z.array(productionReleaseEvidenceReferenceSchema).min(1),
    }),
    signed_outcome_refs: z.array(productionReleaseEvidenceReferenceSchema).min(1),
    verdict: z.literal("PASS"),
    created_at: timestampSchema,
    manifest_hash: contentHashSchema,
  })
  .superRefine((manifest, ctx) => {
    if (manifest.manifest_ref.content_hash !== manifest.manifest_hash) {
      ctx.addIssue({
        code: "custom",
        message: "ReleaseManifest Reference 必须绑定 Manifest 内容哈希。",
        path: ["manifest_ref", "content_hash"],
      });
    }

    const references = [
      ...manifest.eval_run_refs,
      ...manifest.tenancy_evidence_refs,
      ...manifest.deployment_evidence.hosted_refs,
      ...manifest.deployment_evidence.docker_refs,
      ...manifest.signed_outcome_refs,
    ];
    if (
      references.some(
        (reference) =>
          reference.app_id !== manifest.manifest_ref.app_id ||
          reference.tenant_id !== manifest.manifest_ref.tenant_id ||
          reference.environment !== manifest.manifest_ref.environment ||
          reference.run_id !== manifest.manifest_ref.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ReleaseManifest 的全部 Evidence 必须属于同一 App/Tenant/Environment/Run。",
        path: ["deployment_evidence"],
      });
    }

    const identities = references.map(artifactReferenceIdentity);
    if (new Set(identities).size !== identities.length) {
      ctx.addIssue({
        code: "custom",
        message: "ReleaseManifest 不能重复计算同一 Evidence。",
        path: ["signed_outcome_refs"],
      });
    }
  });

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export async function computeReleaseManifestHash(input: unknown): Promise<`sha256:${string}`> {
  const manifest = releaseManifestSchema.parse(input);
  const {
    manifest_hash: _manifestHash,
    manifest_ref: { content_hash: _contentHash, ...manifestIdentity },
    ...facts
  } = manifest;
  return sha256ContentHash({
    ...facts,
    manifest_ref: manifestIdentity,
  });
}

export interface ReleaseManifestAuthorityContext {
  resolveCommitted(
    reference: z.infer<typeof releaseManifestReferenceSchema>,
  ): Promise<unknown | null>;
  verifyCommitted: ArtifactReferenceVerifier;
}

export class ReleaseManifestAuthorityError extends Error {
  override readonly name = "ReleaseManifestAuthorityError";
  readonly code = "RELEASE_MANIFEST_NOT_AUTHORITATIVE";
}

declare const authoritativeReleaseManifest: unique symbol;
const authorizedReleaseManifests = new WeakSet<object>();

export type AuthoritativeReleaseManifest = ReleaseManifest & {
  readonly [authoritativeReleaseManifest]: true;
};

export async function authorizeReleaseManifest(
  referenceInput: unknown,
  authority: ReleaseManifestAuthorityContext,
): Promise<AuthoritativeReleaseManifest> {
  const reference = releaseManifestReferenceSchema.parse(referenceInput);
  const manifest = releaseManifestSchema.parse(await authority.resolveCommitted(reference));
  if (artifactReferenceIdentity(manifest.manifest_ref) !== artifactReferenceIdentity(reference)) {
    throw new ReleaseManifestAuthorityError(
      "ReleaseManifest Resolver 返回了不匹配的 Content-Addressed Revision。",
    );
  }
  if ((await computeReleaseManifestHash(manifest)) !== manifest.manifest_hash) {
    throw new ReleaseManifestAuthorityError("ReleaseManifest Hash 与规范化内容不匹配。");
  }

  const evidenceReferences: ArtifactReference[] = [
    manifest.manifest_ref,
    ...manifest.eval_run_refs,
    ...manifest.tenancy_evidence_refs,
    ...manifest.deployment_evidence.hosted_refs,
    ...manifest.deployment_evidence.docker_refs,
    ...manifest.signed_outcome_refs,
  ];
  const verdicts = await Promise.all(evidenceReferences.map(authority.verifyCommitted));
  if (verdicts.some((verdict) => !verdict)) {
    throw new ReleaseManifestAuthorityError(
      "ReleaseManifest 或其 Hosted/Docker/Outcome Evidence 尚未提交。",
    );
  }

  authorizedReleaseManifests.add(manifest);
  return deepFreeze(manifest) as AuthoritativeReleaseManifest;
}

export function isAuthoritativeReleaseManifest(
  value: unknown,
): value is AuthoritativeReleaseManifest {
  return typeof value === "object" && value !== null && authorizedReleaseManifests.has(value);
}
