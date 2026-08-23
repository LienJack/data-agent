/** Render the reviewed 10661 Knowledge Base Authority migration. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010661_app_data_agent_knowledge_base.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-authority.sql.inc",
  "20-helpers.sql.inc",
  "30-registry-rpcs.sql.inc",
  "40-index-job-rpcs.sql.inc",
  "45-job-successor.sql.inc",
  "46-job-manifest-successor.sql.inc",
  "50-search-rpcs.sql.inc",
  "60-effective-config-successor.sql.inc",
  "65-defaults-successor.sql.inc",
  "80-integrity.sql.inc",
  "90-grants-postconditions.sql.inc",
  "99-ledger.sql.inc",
] as const;
const CHECKSUM_PLACEHOLDER = "__KNOWLEDGE_BASE_MIGRATION_CHECKSUM__";
const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalize(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

const repoRoot = resolve(import.meta.dirname, "..");
const appRoot = resolve(repoRoot, "infra/supabase/apps/data-agent");
const sourceDirectory = resolve(appRoot, "migration-sources/10661");
const migrationPath = resolve(appRoot, "migrations", MIGRATION_NAME);
if (!existsSync(sourceDirectory))
  throw new Error(`10661 source directory missing: ${sourceDirectory}`);
const actual = readdirSync(sourceDirectory)
  .filter((entry) => entry.endsWith(".sql.inc"))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
  throw new Error(`10661 source segment closure mismatch: actual=${actual.join(",")}`);
}
const body = SOURCE_SEGMENTS.map((segment) =>
  normalize(readFileSync(resolve(sourceDirectory, segment), "utf8")),
).join("");
if (body.split(CHECKSUM_PLACEHOLDER).length - 1 !== 1) {
  throw new Error("checksum placeholder must appear exactly once");
}
const bodyWithZero = body.replace(CHECKSUM_PLACEHOLDER, ZERO_CHECKSUM);
const normalized = `-- knowledge_base_migration_checksum: ${ZERO_CHECKSUM}\n${bodyWithZero}`;
const checksum = sha256(normalized);
const content = `-- knowledge_base_migration_checksum: ${checksum}\n${body.replace(CHECKSUM_PLACEHOLDER, checksum)}`;
if (content.split(checksum).length - 1 !== 2) {
  throw new Error("10661 header and ledger must contain the same canonical checksum exactly twice");
}

if (process.argv.includes("--verify")) {
  if (!existsSync(migrationPath) || readFileSync(migrationPath, "utf8") !== content) {
    throw new Error("10661 migration does not match rendered source segments");
  }
  console.log(`10661 migration verified: ${basename(migrationPath)} checksum=${checksum}`);
} else {
  writeFileSync(migrationPath, content);
  console.log(`10661 migration written: ${migrationPath}`);
  console.log(`checksum: ${checksum}`);
}
