import { z } from "zod";
import {
  canonicalizeJson,
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { type KnownArtifactType, knownArtifactTypeSchema, l2ArtifactTypeSchema } from "./types.js";

export const artifactReferenceSchema = z.strictObject({
  artifact_id: immutableIdSchema,
  artifact_type: knownArtifactTypeSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  run_id: immutableIdSchema,
  revision: z.number().int().positive(),
  content_hash: contentHashSchema,
});

export function artifactReferenceFor<const T extends KnownArtifactType>(artifactType: T) {
  const stableArtifactType = knownArtifactTypeSchema.parse(artifactType) as T;
  return artifactReferenceSchema.extend({
    artifact_type: z.literal(stableArtifactType),
  });
}

export function artifactReferenceIdentity(reference: ArtifactReference): string {
  return canonicalizeJson([
    reference.app_id,
    reference.tenant_id,
    reference.environment,
    reference.run_id,
    reference.artifact_id,
    reference.artifact_type,
    reference.revision,
    reference.content_hash,
  ]);
}

const producerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

export const artifactProducerSchema = z.strictObject({
  kind: z.enum(["agent", "deterministic", "external-agent", "human"]),
  id: producerIdSchema,
});

export const deterministicAuthoritySchema = z.strictObject({
  kind: z.literal("deterministic"),
  id: producerIdSchema,
  policy_version: versionIdentifierSchema,
});

export const artifactCommitterCapabilityClaimSchema = z.strictObject({
  kind: z.literal("artifact-committer"),
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  run_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  artifact_type: l2ArtifactTypeSchema,
  producer_id: producerIdSchema,
  policy_version: versionIdentifierSchema,
});

const artifactEnvelopeObjectSchema = z.strictObject({
  artifact_id: immutableIdSchema,
  artifact_type: knownArtifactTypeSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  run_id: immutableIdSchema,
  revision: z.number().int().positive(),
  parent_ref: artifactReferenceSchema.nullable(),
  attempt_id: immutableIdSchema,
  producer: artifactProducerSchema,
  input_refs: z.array(artifactReferenceSchema),
  schema_version: versionIdentifierSchema,
  semantic_version: versionIdentifierSchema,
  policy_version: versionIdentifierSchema,
  model_profile_version: versionIdentifierSchema,
  content_hash: contentHashSchema,
  status: z.enum(["CANDIDATE", "COMMITTED", "REJECTED", "SUPERSEDED"]),
  created_at: timestampSchema,
});

function validateArtifactEnvelope(
  envelope: z.infer<typeof artifactEnvelopeObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (envelope.status !== "CANDIDATE" && envelope.producer.kind !== "deterministic") {
    ctx.addIssue({
      code: "custom",
      message: "只有确定性组件可以提交权威 Artifact Revision。",
      path: ["producer", "kind"],
    });
  }

  if (envelope.revision === 1 && envelope.parent_ref !== null) {
    ctx.addIssue({
      code: "custom",
      message: "首个 Revision 的 parent_ref 必须为 null。",
      path: ["parent_ref"],
    });
  }

  if (envelope.revision > 1) {
    const parent = envelope.parent_ref;
    if (
      !parent ||
      parent.app_id !== envelope.app_id ||
      parent.tenant_id !== envelope.tenant_id ||
      parent.environment !== envelope.environment ||
      parent.run_id !== envelope.run_id ||
      parent.artifact_id !== envelope.artifact_id ||
      parent.artifact_type !== envelope.artifact_type ||
      parent.revision !== envelope.revision - 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: "后续 Revision 必须用完整 parent_ref 直接引用同 Artifact 的前一个 Revision。",
        path: ["parent_ref"],
      });
    }
  }

  for (const [index, reference] of envelope.input_refs.entries()) {
    if (
      reference.app_id !== envelope.app_id ||
      reference.tenant_id !== envelope.tenant_id ||
      reference.environment !== envelope.environment ||
      reference.run_id !== envelope.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Artifact Reference 必须与 Envelope 属于同一 App/Tenant/Environment/Run。",
        path: ["input_refs", index],
      });
    }

    if (reference.artifact_id === envelope.artifact_id && reference.revision >= envelope.revision) {
      ctx.addIssue({
        code: "custom",
        message: "Artifact 不能引用自身的当前或未来 Revision。",
        path: ["input_refs", index, "revision"],
      });
    }
  }
}

export const artifactEnvelopeBaseSchema =
  artifactEnvelopeObjectSchema.superRefine(validateArtifactEnvelope);
export const artifactEnvelopeSchema = artifactEnvelopeBaseSchema;
export const l2ArtifactEnvelopeSchema = artifactEnvelopeObjectSchema
  .extend({
    artifact_type: l2ArtifactTypeSchema,
  })
  .superRefine(validateArtifactEnvelope);

export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>;
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;
export type ArtifactCommitterCapabilityClaim = z.infer<
  typeof artifactCommitterCapabilityClaimSchema
>;
export type ArtifactReferenceVerifier = (reference: ArtifactReference) => Promise<boolean>;
