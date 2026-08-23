/**
 * Render the 10626 semantic candidate compile migration from source segments.
 * Usage: tsx scripts/render-10626-migration.ts [--verify]
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010626_app_data_agent_semantic_candidate_compile.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-authority-tables.sql.inc",
  "20-compile-rpcs.sql.inc",
  "90-grants-postconditions.sql.inc",
  "99-ledger-commit.sql.inc",
] as const;
const CHECKSUM_PLACEHOLDER = "__SEMANTIC_CANDIDATE_COMPILE_MIGRATION_CHECKSUM__";
const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeSegment(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function renderMigration(sourceDirectory: string) {
  if (!existsSync(sourceDirectory))
    throw new Error(`10626 source directory does not exist: ${sourceDirectory}`);
  const actualSegments = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort();
  if (JSON.stringify(actualSegments) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
    throw new Error(`10626 source segment closure mismatch: actual=${actualSegments.join(",")}`);
  }
  const body = SOURCE_SEGMENTS.map((segment) =>
    normalizeSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  ).join("");
  if (body.split(CHECKSUM_PLACEHOLDER).length - 1 !== 1) {
    throw new Error("checksum placeholder must appear exactly once");
  }
  const bodyWithZeroChecksum = body.replace(CHECKSUM_PLACEHOLDER, ZERO_CHECKSUM);
  const normalized = `-- semantic_candidate_compile_migration_checksum: ${ZERO_CHECKSUM}\n${bodyWithZeroChecksum}`;
  const checksum = sha256(normalized);
  return {
    checksum,
    content: `-- semantic_candidate_compile_migration_checksum: ${checksum}\n${bodyWithZeroChecksum.replace(ZERO_CHECKSUM, checksum)}`,
  };
}

const repoRoot = resolve(import.meta.dirname, "..");
const appInfraRoot = resolve(repoRoot, "infra/supabase/apps/data-agent");
const sourceDirectory = resolve(appInfraRoot, "migration-sources/10626");
const migrationPath = resolve(appInfraRoot, "migrations", MIGRATION_NAME);
const rendered = renderMigration(sourceDirectory);

if (process.argv.includes("--verify")) {
  if (!existsSync(migrationPath) || readFileSync(migrationPath, "utf8") !== rendered.content) {
    throw new Error("10626 migration does not match rendered source segments");
  }
  console.log(`10626 migration verified: ${basename(migrationPath)} checksum=${rendered.checksum}`);
} else {
  writeFileSync(migrationPath, rendered.content);
  console.log(`10626 migration written to ${migrationPath}`);
  console.log(`checksum: ${rendered.checksum}`);
}
