import { z } from "zod";
import { contentHashSchema } from "../common/primitives.js";

export const RUNTIME_MIGRATION_FACT_VERSION = "runtime-migration-fact@1.0.0" as const;

export const runtimeMigrationFactSchema = z.strictObject({
  schema_version: z.literal(RUNTIME_MIGRATION_FACT_VERSION),
  migration_ready: z.literal(true),
  migration_frontier: contentHashSchema.transform(
    (value): `sha256:${string}` => value as `sha256:${string}`,
  ),
});

export type RuntimeMigrationFact = z.infer<typeof runtimeMigrationFactSchema>;
