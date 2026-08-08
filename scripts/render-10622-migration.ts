/**
 * Render the 10622 Semantic Candidate Draft migration from source segments.
 * Usage: tsx scripts/render-10622-migration.ts [--verify]
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010622_app_data_agent_semantic_candidate_draft.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-idempotency.sql.inc",
  "15-candidate-authority-grants.sql.inc",
  "20-candidate-rpc.sql.inc",
  "30-publish-nullability.sql.inc",
  "32-semantic-lock-key-repair.sql.inc",
  "35-digest-compatibility-cleanup.sql.inc",
  "90-postconditions.sql.inc",
  "99-ledger-commit.sql.inc",
] as const;
const CHECKSUM_PLACEHOLDER = "__SEMANTIC_DRAFT_MIGRATION_CHECKSUM__";
const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeSegment(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function renderMigration(sourceDirectory: string) {
  if (!existsSync(sourceDirectory)) {
    throw new Error(`10622 source directory does not exist: ${sourceDirectory}`);
  }
  const actualSegments = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort();
  const expectedSegments = [...SOURCE_SEGMENTS].sort();
  if (JSON.stringify(actualSegments) !== JSON.stringify(expectedSegments)) {
    throw new Error(`10622 source segment closure mismatch: actual=${actualSegments.join(",")}`);
  }
  const body = SOURCE_SEGMENTS.map((segment) =>
    normalizeSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  ).join("");
  const placeholderCount = body.split(CHECKSUM_PLACEHOLDER).length - 1;
  if (placeholderCount !== 1) {
    throw new Error(`checksum placeholder must appear exactly once: found=${placeholderCount}`);
  }
  const bodyWithZeroChecksum = body.replace(CHECKSUM_PLACEHOLDER, ZERO_CHECKSUM);
  const normalized = `-- semantic_draft_migration_checksum: ${ZERO_CHECKSUM}\n${bodyWithZeroChecksum}`;
  const checksum = sha256(normalized);
  return {
    checksum,
    content: `-- semantic_draft_migration_checksum: ${checksum}\n${bodyWithZeroChecksum.replace(ZERO_CHECKSUM, checksum)}`,
  };
}

const repoRoot = resolve(import.meta.dirname, "..");
const appInfraRoot = resolve(repoRoot, "infra/supabase/apps/data-agent");
const sourceDirectory = resolve(appInfraRoot, "migration-sources/10622");
const migrationPath = resolve(appInfraRoot, "migrations", MIGRATION_NAME);
const rendered = renderMigration(sourceDirectory);

if (process.argv.includes("--verify")) {
  if (!existsSync(migrationPath) || readFileSync(migrationPath, "utf8") !== rendered.content) {
    throw new Error("10622 migration does not match rendered source segments");
  }
  console.log(`10622 migration verified: ${basename(migrationPath)} checksum=${rendered.checksum}`);
} else {
  writeFileSync(migrationPath, rendered.content);
  console.log(`10622 migration written to ${migrationPath}`);
  console.log(`checksum: ${rendered.checksum}`);
}
