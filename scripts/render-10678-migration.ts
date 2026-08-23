import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010678_app_data_agent_legacy_attribution_cleanup.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-authority.sql.inc",
  "20-functions.sql.inc",
  "90-grants-postconditions.sql.inc",
  "99-ledger.sql.inc",
] as const;
const PLACEHOLDER = "__LEGACY_ATTRIBUTION_CLEANUP_MIGRATION_CHECKSUM__";
const ZERO = `sha256:${"0".repeat(64)}`;

function normalize(value: string): string {
  return `${value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function render(sourceDirectory: string) {
  const actual = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
    throw new Error(`10678 source segment closure mismatch: ${actual.join(",")}`);
  }
  const body = SOURCE_SEGMENTS.map((segment) =>
    normalize(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  ).join("");
  if (body.split(PLACEHOLDER).length - 1 !== 1) {
    throw new Error("10678 checksum placeholder must appear exactly once");
  }
  const normalized = `-- legacy_attribution_cleanup_migration_checksum: ${ZERO}\n${body.replace(PLACEHOLDER, ZERO)}`;
  const checksum = `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
  const content = `-- legacy_attribution_cleanup_migration_checksum: ${checksum}\n${body.replace(PLACEHOLDER, checksum)}`;
  if (
    content.split("execute pg_catalog.format('delete from app_data_agent.%I',target)").length -
      1 !==
      1 ||
    /\b(truncate|drop\s+table)\b/i.test(content)
  ) {
    throw new Error("10678 migration destructive authority is not narrowly enclosed");
  }
  return { content, checksum };
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migration-sources/10678",
);
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations",
  MIGRATION_NAME,
);
const rendered = render(sourceDirectory);
if (process.argv.includes("--verify")) {
  if (!existsSync(migrationPath) || readFileSync(migrationPath, "utf8") !== rendered.content) {
    throw new Error("10678 migration does not match rendered source segments");
  }
  console.log(`10678 migration verified: ${basename(migrationPath)} checksum=${rendered.checksum}`);
} else {
  writeFileSync(migrationPath, rendered.content);
  console.log(`10678 migration written: ${basename(migrationPath)} checksum=${rendered.checksum}`);
}
