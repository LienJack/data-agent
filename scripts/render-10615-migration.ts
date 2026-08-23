/**
 * Render the 10615 published-only bridge migration from source segments.
 * Usage: tsx scripts/render-10615-migration.ts [--verify]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010615_app_data_agent_semantic_published_bridge.sql";
const MIGRATION_VERSION = "20260725010615_app_data_agent_semantic_published_bridge";
const APP_ID = "00000000-0000-4000-8000-00000000da01";

const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-activation-rpcs.sql.inc",
  "20-published-bridge.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-ledger-commit.sql.inc",
] as const;

const CHECKSUM_PLACEHOLDER = "__SEMANTIC_MIGRATION_CHECKSUM__";
const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeSegment(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function finalLedgerBlock(checksum: string): string {
  return [
    "select platform.assert_migration_checksum(",
    "  'app',",
    `  '${APP_ID}'::uuid,`,
    `  '${MIGRATION_VERSION}',`,
    `  '${checksum}'`,
    ");",
    "",
    "commit;",
    "",
  ].join("\n");
}

function render10615Migration(sourceDirectory: string): {
  content: string;
  checksum: `sha256:${string}`;
} {
  if (!existsSync(sourceDirectory)) {
    throw new Error(`10615 source directory does not exist: ${sourceDirectory}`);
  }

  const normalizedSegments = SOURCE_SEGMENTS.map((segment) =>
    normalizeSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  );
  const body = normalizedSegments.join("");

  // Count placeholder occurrences
  const placeholderCount = body.split(CHECKSUM_PLACEHOLDER).length - 1;
  if (placeholderCount !== 1) {
    throw new Error(`checksum placeholder must appear exactly once: found=${placeholderCount}`);
  }

  // Compute normalized bytes for checksum
  const bodyWithZeroChecksum = body.replace(CHECKSUM_PLACEHOLDER, ZERO_CHECKSUM);
  const normalized = `-- semantic_migration_checksum: ${ZERO_CHECKSUM}\n${bodyWithZeroChecksum}`;
  const checksum = sha256(normalized);

  // Build final content with real checksum
  const content = `-- semantic_migration_checksum: ${checksum}\n${bodyWithZeroChecksum.replace(CHECKSUM_PLACEHOLDER, checksum)}`;

  if (!content.includes(checksum)) {
    throw new Error("10615 checksum self-verification failed");
  }

  return { content, checksum };
}

function defaultPaths(repoRoot: string) {
  const appInfraRoot = resolve(repoRoot, "infra/supabase/apps/data-agent");
  return {
    sourceDirectory: resolve(appInfraRoot, "migration-sources/10615"),
    migrationPath: resolve(appInfraRoot, "migrations", MIGRATION_NAME),
  };
}

// Main
const repoRoot = resolve(import.meta.dirname, "..");
const paths = defaultPaths(repoRoot);

if (process.argv.includes("--verify")) {
  if (!existsSync(paths.migrationPath)) {
    throw new Error(`10615 migration file not found: ${paths.migrationPath}`);
  }
  const rendered = render10615Migration(paths.sourceDirectory);
  const migration = readFileSync(paths.migrationPath, "utf8");
  if (migration !== rendered.content) {
    throw new Error("10615 migration does not match rendered source segments");
  }
  console.log(
    `10615 migration verified: ${basename(paths.migrationPath)} checksum=${rendered.checksum}`,
  );
} else {
  const rendered = render10615Migration(paths.sourceDirectory);
  writeFileSync(paths.migrationPath, rendered.content);
  console.log(`✅ 10615 migration written to ${paths.migrationPath}`);
  console.log(`checksum: ${rendered.checksum}`);
  console.log(`content length: ${rendered.content.length} bytes`);
}
