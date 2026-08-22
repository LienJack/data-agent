/** Render the reviewed 10693 semantic Revision pointer-read repair migration. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010693_app_data_agent_semantic_revision_pointer_read_repair.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-repair.sql.inc",
  "90-postconditions.sql.inc",
  "99-ledger.sql.inc",
] as const;
const PLACEHOLDER = "__SEMANTIC_REVISION_POINTER_READ_REPAIR_MIGRATION_CHECKSUM__";
const ZERO = `sha256:${"0".repeat(64)}`;
const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const normalize = (value: string) => `${value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
const root = resolve(import.meta.dirname, "..");
const appRoot = resolve(root, "infra/supabase/apps/data-agent");
const sourceRoot = resolve(appRoot, "migration-sources/10693");
const output = resolve(appRoot, "migrations", MIGRATION_NAME);

if (!existsSync(sourceRoot)) throw new Error("10693 source missing");
const actual = readdirSync(sourceRoot)
  .filter((entry) => entry.endsWith(".sql.inc"))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
  throw new Error(`10693 segment closure mismatch: ${actual.join(",")}`);
}
const body = SOURCE_SEGMENTS.map((segment) =>
  normalize(readFileSync(resolve(sourceRoot, segment), "utf8")),
).join("");
if (body.split(PLACEHOLDER).length - 1 !== 1)
  throw new Error("10693 checksum placeholder mismatch");
const checksum = digest(
  `-- semantic_revision_pointer_read_repair_migration_checksum: ${ZERO}\n${body.replace(PLACEHOLDER, ZERO)}`,
);
const content = `-- semantic_revision_pointer_read_repair_migration_checksum: ${checksum}\n${body.replace(PLACEHOLDER, checksum)}`;
if (content.split(checksum).length - 1 !== 2) throw new Error("10693 checksum count mismatch");
if (process.argv.includes("--verify")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== content) {
    throw new Error("10693 migration does not match source");
  }
  console.log(`10693 migration verified: ${basename(output)} checksum=${checksum}`);
} else {
  writeFileSync(output, content);
  console.log(`10693 migration written: ${output}`);
  console.log(`checksum: ${checksum}`);
}
