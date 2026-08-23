import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { z } from "zod";

const checksumSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), {
    message: "path must stay inside the repository",
  });
const manifestSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  migration_name: z.string().regex(/^\d{14}_[a-z0-9_]+\.sql$/),
  source_directory: relativePathSchema,
  segments: z
    .array(z.string().regex(/^[a-z0-9-]+\.sql\.inc$/))
    .min(1)
    .refine((segments) => new Set(segments).size === segments.length, {
      message: "segments must be unique",
    }),
  placeholder: z.string().regex(/^__[A-Z0-9_]+_CHECKSUM__$/),
  checksum_header: z.string().regex(/^[a-z0-9_]+_migration_checksum$/),
  postcondition: z
    .strictObject({
      checksum_occurrences: z.number().int().positive(),
    })
    .optional(),
});
const exceptionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  renderer: relativePathSchema.refine((value) => value.endsWith(".ts")),
  reason: z.string().trim().min(1),
  verification_command: z.string().trim().min(1),
});
const registrySchema = z.strictObject({
  schema_version: z.literal("migration-renderer-manifests@1.0.0"),
  entries: z.array(manifestSchema).min(1),
  exceptions: z.array(exceptionSchema).min(1),
});

export type MigrationManifest = z.infer<typeof manifestSchema>;
export type MigrationRendererException = z.infer<typeof exceptionSchema>;
export type MigrationManifestRegistry = z.infer<typeof registrySchema>;

export interface RenderedMigration {
  readonly checksum: `sha256:${string}`;
  readonly content: string;
  readonly migrationPath: string;
}

const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizedSegment(value: string): string {
  return `${value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function repositoryPath(repositoryRoot: string, path: string): string {
  const root = resolve(repositoryRoot);
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`MIGRATION_MANIFEST_PATH_ESCAPE: ${path}`);
  }
  return resolved;
}

export function parseMigrationRendererRegistry(source: string): MigrationManifestRegistry {
  const registry = registrySchema.parse(JSON.parse(source));
  const { entries, exceptions } = registry;
  const ids = new Set<string>();
  const migrationNames = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`MIGRATION_MANIFEST_DUPLICATE_ID: ${entry.id}`);
    if (migrationNames.has(entry.migration_name)) {
      throw new Error(`MIGRATION_MANIFEST_DUPLICATE_NAME: ${entry.migration_name}`);
    }
    ids.add(entry.id);
    migrationNames.add(entry.migration_name);
  }
  const exceptionIds = new Set<string>();
  const exceptionRenderers = new Set<string>();
  for (const exception of exceptions) {
    if (ids.has(exception.id) || exceptionIds.has(exception.id)) {
      throw new Error(`MIGRATION_MANIFEST_DUPLICATE_ID: ${exception.id}`);
    }
    if (exceptionRenderers.has(exception.renderer)) {
      throw new Error(`MIGRATION_EXCEPTION_DUPLICATE_RENDERER: ${exception.renderer}`);
    }
    exceptionIds.add(exception.id);
    exceptionRenderers.add(exception.renderer);
  }
  return registry;
}

export function parseMigrationManifestRegistry(source: string): MigrationManifest[] {
  return parseMigrationRendererRegistry(source).entries;
}

export function renderMigration(
  manifest: MigrationManifest,
  repositoryRoot: string,
): RenderedMigration {
  const sourceDirectory = repositoryPath(repositoryRoot, manifest.source_directory);
  if (!existsSync(sourceDirectory)) {
    throw new Error(`MIGRATION_SOURCE_MISSING: ${manifest.id} ${sourceDirectory}`);
  }
  const actualSegments = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort();
  const expectedSegments = [...manifest.segments].sort();
  if (JSON.stringify(actualSegments) !== JSON.stringify(expectedSegments)) {
    throw new Error(
      `MIGRATION_SEGMENT_CLOSURE_DRIFT: ${manifest.id} actual=${actualSegments.join(",")}`,
    );
  }

  const body = manifest.segments
    .map((segment) => normalizedSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")))
    .join("");
  const placeholderCount = body.split(manifest.placeholder).length - 1;
  if (placeholderCount !== 1) {
    throw new Error(`MIGRATION_PLACEHOLDER_DRIFT: ${manifest.id} found=${placeholderCount}`);
  }

  const bodyWithZero = body.replace(manifest.placeholder, ZERO_CHECKSUM);
  const normalized = `-- ${manifest.checksum_header}: ${ZERO_CHECKSUM}\n${bodyWithZero}`;
  const checksum = checksumSchema.parse(sha256(normalized)) as `sha256:${string}`;
  const content = `-- ${manifest.checksum_header}: ${checksum}\n${body.replace(
    manifest.placeholder,
    checksum,
  )}`;
  const expectedOccurrences = manifest.postcondition?.checksum_occurrences;
  if (
    expectedOccurrences !== undefined &&
    content.split(checksum).length - 1 !== expectedOccurrences
  ) {
    throw new Error(`MIGRATION_POSTCONDITION_FAILED: ${manifest.id} checksum_occurrences`);
  }

  return {
    checksum,
    content,
    migrationPath: repositoryPath(
      repositoryRoot,
      `infra/supabase/apps/data-agent/migrations/${manifest.migration_name}`,
    ),
  };
}

export function verifyMigration(
  manifest: MigrationManifest,
  repositoryRoot: string,
): RenderedMigration {
  const rendered = renderMigration(manifest, repositoryRoot);
  if (
    !existsSync(rendered.migrationPath) ||
    readFileSync(rendered.migrationPath, "utf8") !== rendered.content
  ) {
    throw new Error(
      `MIGRATION_RENDER_DRIFT: ${manifest.id} ${relative(repositoryRoot, rendered.migrationPath)}`,
    );
  }
  return rendered;
}

export function writeMigration(
  manifest: MigrationManifest,
  repositoryRoot: string,
): RenderedMigration {
  const rendered = renderMigration(manifest, repositoryRoot);
  writeFileSync(rendered.migrationPath, rendered.content, "utf8");
  return rendered;
}

export function migrationSummary(manifest: MigrationManifest, rendered: RenderedMigration): string {
  return `${manifest.id}: ${basename(rendered.migrationPath)} checksum=${rendered.checksum}`;
}
