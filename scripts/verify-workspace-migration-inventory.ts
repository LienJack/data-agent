import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_GLOBAL_EXCEPTIONS = new Set([
  "app_data_agent.app_users",
  "app_data_agent.identity_audit_log",
  "app_data_agent.identity_operation_receipts",
  "app_data_agent.identity_operations",
  "app_data_agent.research_lifecycle_cleanup_batch_receipts",
  "app_data_agent.research_lifecycle_cleanup_operations",
  "app_data_agent.workspaces",
]);

const migrationDirectory = resolve(
  import.meta.dirname,
  "../infra/supabase/apps/data-agent/migrations",
);
const tablePattern =
  /create table(?: if not exists)?\s+((?:app_data_agent|semantic|catalog)\.[a-z0-9_]+)\s*\((.*?)\n\);/gs;

const discovered = new Map<string, "WORKSPACE" | "APP_GLOBAL">();
for (const entry of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort()) {
  const sql = readFileSync(resolve(migrationDirectory, entry), "utf8");
  for (const match of sql.matchAll(tablePattern)) {
    const tableName = match[1];
    const body = match[2];
    if (!tableName || body === undefined) throw new Error(`invalid table match in ${entry}`);
    const classification = /\btenant_id\b/.test(body) ? "WORKSPACE" : "APP_GLOBAL";
    const previous = discovered.get(tableName);
    if (previous && previous !== classification) {
      throw new Error(`table classification changed across migrations: ${tableName}`);
    }
    discovered.set(tableName, classification);
  }
}

if (discovered.size === 0) throw new Error("workspace migration inventory discovered no tables");

const unexpectedGlobal = [...discovered]
  .filter(([, classification]) => classification === "APP_GLOBAL")
  .map(([name]) => name)
  .filter((name) => !APP_GLOBAL_EXCEPTIONS.has(name));
const missingGlobal = [...APP_GLOBAL_EXCEPTIONS].filter(
  (name) => discovered.get(name) !== "APP_GLOBAL",
);

if (unexpectedGlobal.length > 0 || missingGlobal.length > 0) {
  throw new Error(
    `workspace migration inventory mismatch unexpected_global=${unexpectedGlobal.join(",")} missing_global=${missingGlobal.join(",")}`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    schema_version: "workspace-migration-inventory@1.0.0",
    workspace_scoped_tables: [...discovered.values()].filter((value) => value === "WORKSPACE")
      .length,
    app_global_tables: [...APP_GLOBAL_EXCEPTIONS].sort(),
    total_tables: discovered.size,
  })}\n`,
);
