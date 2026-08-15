/** Render the reviewed 10644 Semantic Authoring Events migration. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010644_app_data_agent_semantic_authoring_events.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-event-list-rpc.sql.inc",
  "90-postconditions.sql.inc",
  "99-ledger-commit.sql.inc",
] as const;
const PLACEHOLDER = "__SEMANTIC_AUTHORING_EVENTS_MIGRATION_CHECKSUM__";
const ZERO = `sha256:${"0".repeat(64)}`;
const sha256 = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const normalize = (value: string): string =>
  `${value.replace(/\r\n?/gu, "\n").replace(/\n+$/gu, "")}\n`;
const repositoryRoot = resolve(import.meta.dirname, "..");
const appRoot = resolve(repositoryRoot, "infra/supabase/apps/data-agent");
const sourceDirectory = resolve(appRoot, "migration-sources/10644");
const migrationPath = resolve(appRoot, "migrations", MIGRATION_NAME);
const actual = readdirSync(sourceDirectory)
  .filter((entry) => entry.endsWith(".sql.inc"))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
  throw new Error(`10644 source segment closure mismatch: actual=${actual.join(",")}`);
}
const body = SOURCE_SEGMENTS.map((segment) =>
  normalize(readFileSync(resolve(sourceDirectory, segment), "utf8")),
).join("");
if (body.split(PLACEHOLDER).length - 1 !== 1) {
  throw new Error("checksum placeholder must appear exactly once");
}
const zeroBody = body.replace(PLACEHOLDER, ZERO);
const checksum = sha256(zeroBody);
const content = zeroBody.replace(ZERO, checksum);
if (process.argv.includes("--verify")) {
  if (!existsSync(migrationPath) || readFileSync(migrationPath, "utf8") !== content) {
    throw new Error("10644 migration does not match rendered source segments");
  }
  console.log(`10644 migration verified: ${basename(migrationPath)} checksum=${checksum}`);
} else {
  writeFileSync(migrationPath, content);
  console.log(`10644 migration written: ${migrationPath}`);
  console.log(`checksum: ${checksum}`);
}
