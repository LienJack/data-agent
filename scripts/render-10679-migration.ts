import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const MIGRATION_NAME = "20260725010679_app_data_agent_legacy_attribution_scope_repair.sql";
const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-scope-repair.sql.inc",
  "90-postconditions-ledger.sql.inc",
] as const;
const PLACEHOLDER = "__LEGACY_ATTRIBUTION_SCOPE_REPAIR_MIGRATION_CHECKSUM__";
const ZERO = `sha256:${"0".repeat(64)}`;

function normalize(value: string): string {
  return `${value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function render(sourceDirectory: string) {
  const actual = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify([...SOURCE_SEGMENTS].sort())) {
    throw new Error(`10679 source segment closure mismatch: ${actual.join(",")}`);
  }
  const body = SOURCE_SEGMENTS.map((segment) =>
    normalize(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  ).join("");
  if (body.split(PLACEHOLDER).length - 1 !== 1) {
    throw new Error("10679 checksum placeholder must appear exactly once");
  }
  const normalized = `-- legacy_attribution_scope_repair_migration_checksum: ${ZERO}\n${body.replaceAll(PLACEHOLDER, ZERO)}`;
  const checksum = `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
  const content = `-- legacy_attribution_scope_repair_migration_checksum: ${checksum}\n${body.replaceAll(PLACEHOLDER, checksum)}`;
  if (
    content.split("delete_unscoped constant text :=").length - 1 !== 1 ||
    content.split("delete_scoped constant text :=").length - 1 !== 1 ||
    content.split("execute pg_catalog.replace(execute_definition,delete_unscoped,delete_scoped);")
      .length -
      1 !==
      1 ||
    content.includes("execute pg_catalog.format('delete from app_data_agent.%I',target);") ||
    /\b(truncate|drop\s+table)\b/i.test(content)
  ) {
    throw new Error("10679 scoped cleanup repair is not fail closed");
  }
  return { content, checksum };
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migration-sources/10679",
);
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations",
  MIGRATION_NAME,
);
const rendered = render(sourceDirectory);
if (process.argv.includes("--verify")) {
  if (!existsSync(migrationPath) || readFileSync(migrationPath, "utf8") !== rendered.content) {
    throw new Error("10679 migration does not match rendered source segments");
  }
  console.log(`10679 migration verified: ${basename(migrationPath)} checksum=${rendered.checksum}`);
} else {
  writeFileSync(migrationPath, rendered.content);
  console.log(`10679 migration written: ${basename(migrationPath)} checksum=${rendered.checksum}`);
}
