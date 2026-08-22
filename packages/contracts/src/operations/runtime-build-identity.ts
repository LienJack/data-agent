import { z } from "zod";
import { contentHashSchema, timestampSchema } from "../common/primitives.js";

export const RUNTIME_BUILD_IDENTITY_VERSION = "runtime-build-identity@1.0.0" as const;

export const runtimeBuildConsumerRoleSchema = z.enum([
  "web",
  "worker",
  "relationship-indexer",
  "semantic-authoring",
]);

const runtimeContentHashSchema = contentHashSchema.transform(
  (value): `sha256:${string}` => value as `sha256:${string}`,
);

export const runtimeBuildIdentitySchema = z
  .object({
    schema_version: z.literal(RUNTIME_BUILD_IDENTITY_VERSION),
    consumer_role: runtimeBuildConsumerRoleSchema,
    generation_id: runtimeContentHashSchema,
    build_id: runtimeContentHashSchema,
    built_at: timestampSchema,
    git_commit: z.string().regex(/^[a-f0-9]{7,64}$/),
    git_dirty: z.boolean(),
  })
  .strict();

export type RuntimeBuildConsumerRole = z.infer<typeof runtimeBuildConsumerRoleSchema>;
export type RuntimeBuildIdentity = z.infer<typeof runtimeBuildIdentitySchema>;
