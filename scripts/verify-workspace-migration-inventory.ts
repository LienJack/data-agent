import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyMigrationInventory } from "./lib/workspace-migration-inventory.js";

const APP_GLOBAL_EXCEPTIONS = new Set([
  "app_data_agent.agent_profile_revisions",
  "app_data_agent.billing_audit_log",
  "app_data_agent.billing_operations",
  "app_data_agent.billing_reconciliation_findings",
  "app_data_agent.billing_runtime_state",
  "app_data_agent.commercial_archive_retirement_receipts",
  "app_data_agent.app_users",
  "app_data_agent.credit_accounts",
  "app_data_agent.credit_hold_events",
  "app_data_agent.credit_holds",
  "app_data_agent.credit_ledger_entries",
  "app_data_agent.demo_dataset_active_versions",
  "app_data_agent.demo_dataset_versions",
  "app_data_agent.falcon_import_receipts",
  "app_data_agent.fx_rate_candidates",
  "app_data_agent.fx_rate_versions",
  "app_data_agent.identity_audit_log",
  "app_data_agent.identity_operation_receipts",
  "app_data_agent.identity_operations",
  "app_data_agent.job_handler_revisions",
  "app_data_agent.legacy_attribution_cleanup_receipts",
  "app_data_agent.model_bill_events",
  "app_data_agent.model_bill_price_components",
  "app_data_agent.model_billing_operations",
  "app_data_agent.model_catalog_entries",
  "app_data_agent.model_config_versions",
  "app_data_agent.model_control_audit_log",
  "app_data_agent.model_control_operations",
  "app_data_agent.model_price_candidate_components",
  "app_data_agent.model_price_candidates",
  "app_data_agent.model_price_components",
  "app_data_agent.model_price_versions",
  "app_data_agent.model_provider_connection_versions",
  "app_data_agent.model_provider_connections",
  "app_data_agent.pricing_audit_log",
  "app_data_agent.pricing_control_operations",
  "app_data_agent.pricing_control_state",
  "app_data_agent.pricing_sync_operations",
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
const migrationEntries = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrationSources = migrationEntries.map((name) => ({
  name,
  sql: readFileSync(resolve(migrationDirectory, name), "utf8"),
}));
const migrationInventory = verifyMigrationInventory(migrationSources);
if (migrationInventory.violations.length > 0) {
  throw new Error(
    `migration identity inventory failed: ${migrationInventory.violations
      .map((violation) => `${violation.code}:${violation.file}`)
      .join(" ")}`,
  );
}

for (const entry of migrationEntries) {
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
    migration_frontier: migrationInventory.frontier,
    next_migration_sequence: migrationInventory.nextSequence,
    total_tables: discovered.size,
  })}\n`,
);
