import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { versionedResourceReferenceSchema } from "../workspaces/defaults.js";

const canonicalCapabilitiesSchema = z
  .array(versionIdentifierSchema)
  .min(1)
  .max(256)
  .superRefine((values, ctx) => {
    values.forEach((value, index) => {
      if (index > 0 && (values[index - 1] ?? "") >= value) {
        ctx.addIssue({
          code: "custom",
          message: "Capabilities must be unique and sorted.",
          path: [index],
        });
      }
    });
  });

const skillRevisionDraftSchema = z.strictObject({
  schema_version: z.literal("skill-revision@1.0.0"),
  scope: appScopeSchema,
  skill_id: immutableIdSchema,
  revision: z.number().int().positive().safe(),
  name: z.string().trim().min(1).max(128),
  source_url: z.url().refine((value) => new URL(value).protocol === "https:", "HTTPS required."),
  package_hash: contentHashSchema,
  dependency_lock_hash: contentHashSchema,
  signer_id: immutableIdSchema,
  signature_hash: contentHashSchema,
  publisher_trust: z.enum(["TRUSTED_PUBLISHER", "WORKSPACE_SIGNER"]),
  approval_status: z.enum(["APPROVED", "QUARANTINED"]),
  capabilities: canonicalCapabilitiesSchema,
  default_resources: z.array(versionedResourceReferenceSchema).max(128),
  install_scripts: z.tuple([]),
});

export const skillRevisionSchema = skillRevisionDraftSchema.extend({
  revision_hash: contentHashSchema,
});

export async function buildSkillRevision(input: unknown) {
  const draft = skillRevisionDraftSchema.parse(input);
  return deepFreeze(
    skillRevisionSchema.parse({ ...draft, revision_hash: await sha256ContentHash(draft) }),
  );
}

export async function verifySkillRevision(input: unknown) {
  const revision = skillRevisionSchema.parse(input);
  const { revision_hash: _hash, ...draft } = revision;
  if ((await sha256ContentHash(draft)) !== revision.revision_hash) {
    throw new TypeError("SKILL_REVISION_HASH_MISMATCH");
  }
  return revision;
}

export const skillHeadSchema = z.strictObject({
  schema_version: z.literal("skill-head@1.0.0"),
  scope: appScopeSchema,
  skill_id: immutableIdSchema,
  active_revision: z.number().int().positive().safe(),
  active_revision_hash: contentHashSchema,
  lifecycle: z.enum(["ENABLED", "DISABLED", "QUARANTINED", "REVOKED"]),
  signer_revocation_version: z.number().int().nonnegative().safe(),
  version: z.number().int().positive().safe(),
  updated_at: timestampSchema,
});

export const skillRegistryItemSchema = z.strictObject({
  schema_version: z.literal("skill-registry-item@1.0.0"),
  revision: skillRevisionSchema,
  head: skillHeadSchema,
});

export type SkillRevision = z.infer<typeof skillRevisionSchema>;
export type SkillHead = z.infer<typeof skillHeadSchema>;
export type SkillRegistryItem = z.infer<typeof skillRegistryItemSchema>;
