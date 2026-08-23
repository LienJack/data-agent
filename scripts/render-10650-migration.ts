/** Render the reviewed 10650 model provider command guard migration. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010650_app_data_agent_model_provider_command_guard.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-provider-command-guard.sql.inc",
  "90-grants-postconditions.sql.inc",
  "99-ledger-commit.sql.inc",
] as const;
const CHECKSUM_PLACEHOLDER = "__MODEL_PROVIDER_COMMAND_GUARD_MIGRATION_CHECKSUM__";
const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function normalize(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

const repoRoot = resolve(import.meta.dirname, "..");
const appRoot = resolve(repoRoot, "infra/supabase/apps/data-agent");
const sourceDirectory = resolve(appRoot, "migration-sources/10650");
const migrationPath = resolve(appRoot, "migrations", MIGRATION_NAME);
if (!existsSync(sourceDirectory))
  throw new Error(`10650 source directory missing: ${sourceDirectory}`);
const actual = readdirSync(sourceDirectory)
  .filter((entry) => entry.endsWith(".sql.inc"))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
  throw new Error(`10650 source segment closure mismatch: actual=${actual.join(",")}`);
}
const body = SOURCE_SEGMENTS.map((segment) =>
  normalize(readFileSync(resolve(sourceDirectory, segment), "utf8")),
).join("");
if (body.split(CHECKSUM_PLACEHOLDER).length - 1 !== 1) {
  throw new Error("checksum placeholder must appear exactly once");
}
const bodyWithZero = body.replace(CHECKSUM_PLACEHOLDER, ZERO_CHECKSUM);
const normalized = `-- model_provider_command_guard_migration_checksum: ${ZERO_CHECKSUM}\n${bodyWithZero}`;
const checksum = sha256(normalized);
const content = `-- model_provider_command_guard_migration_checksum: ${checksum}\n${bodyWithZero.replace(ZERO_CHECKSUM, checksum)}`;

if (process.argv.includes("--verify")) {
  if (!existsSync(migrationPath) || readFileSync(migrationPath, "utf8") !== content) {
    throw new Error("10650 migration does not match rendered source segments");
  }
  console.log(`10650 migration verified: ${basename(migrationPath)} checksum=${checksum}`);
} else {
  writeFileSync(migrationPath, content);
  console.log(`10650 migration written: ${migrationPath}`);
  console.log(`checksum: ${checksum}`);
}
