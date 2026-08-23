import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyMigrationInventory } from "../scripts/lib/workspace-migration-inventory.js";

const repoRoot = resolve(import.meta.dirname, "..");
const migrationRoot = resolve(repoRoot, "infra/supabase/apps/data-agent/migrations");
const sourceRoot = resolve(repoRoot, "infra/supabase/apps/data-agent/migration-sources/10703");
const migrationName = "20260725010703_app_data_agent_commercial_archive_retirement.sql";
const migration = readFileSync(resolve(migrationRoot, migrationName), "utf8");
const archiveRelations = [
  "pricing_control_state",
  "pricing_sync_operations",
  "model_price_candidates",
  "model_price_candidate_components",
  "model_price_versions",
  "model_price_components",
  "fx_rate_candidates",
  "fx_rate_versions",
  "pricing_control_operations",
  "pricing_audit_log",
  "credit_accounts",
  "credit_ledger_entries",
  "credit_holds",
  "credit_hold_events",
  "billing_operations",
  "billing_audit_log",
  "billing_runtime_state",
  "model_bills",
  "model_bill_price_components",
  "model_bill_events",
  "model_billing_operations",
  "billing_reconciliation_findings",
] as const;

describe("10703 commercial archive retirement", () => {
  it("is the migration frontier with a closed deterministic source set", () => {
    const migrationSources = readdirSync(migrationRoot)
      .filter((entry) => entry.endsWith(".sql"))
      .sort()
      .map((entry) => ({ name: entry, sql: readFileSync(resolve(migrationRoot, entry), "utf8") }));
    const inventory = verifyMigrationInventory(migrationSources);
    expect(inventory.violations).toEqual([]);
    expect(inventory.frontier).toBe("20260725010706");
    expect(readdirSync(sourceRoot).sort()).toEqual([
      "00-preamble.sql.inc",
      "10-model-control-authority.sql.inc",
      "20-model-control-rewrite.sql.inc",
      "30-commercial-archive.sql.inc",
      "90-postconditions.sql.inc",
      "99-ledger.sql.inc",
    ]);
  });

  it("freezes the exact historical relation closure without copying or deleting rows", () => {
    const preamble = readFileSync(resolve(sourceRoot, "00-preamble.sql.inc"), "utf8");
    const archive = readFileSync(resolve(sourceRoot, "30-commercial-archive.sql.inc"), "utf8");
    expect(archiveRelations).toHaveLength(22);
    for (const relation of archiveRelations) {
      expect(preamble, relation).toContain(`'${relation}'`);
      expect(archive, relation).toContain(`'${relation}'`);
    }
    expect(migration).not.toMatch(
      /delete from app_data_agent\.(?:pricing|credit|billing|model_bill)/i,
    );
    expect(migration).not.toMatch(
      /insert into app_data_agent\.model_control_(?:operations|audit_log)\s+select/i,
    );
  });

  it("drops retired RPCs and gives Model Control its own authority tables", () => {
    expect(migration).toMatch(/create table app_data_agent\.model_control_operations/);
    expect(migration).toMatch(/create table app_data_agent\.model_control_audit_log/);
    for (const rpc of [
      "submit_pricing_sync",
      "apply_credit_adjustment",
      "authorize_model_billing",
      "list_model_price_candidates",
      "list_credit_accounts",
      "get_billing_runtime_state",
    ]) {
      expect(migration, rpc).toMatch(
        new RegExp(`drop function (?:app_data_agent|platform)\\.${rpc}`),
      );
    }
    expect(migration).not.toMatch(/(?:compatibility|redirect|retired_wrapper)/i);
  });

  it("removes commercial dependencies from current Model Control definitions", () => {
    const rewrite = readFileSync(resolve(sourceRoot, "20-model-control-rewrite.sql.inc"), "utf8");
    expect(rewrite).toContain("app_data_agent.model_control_operations");
    expect(rewrite).toContain("app_data_agent.model_control_audit_log");
    expect(rewrite).toContain("target_status := ''ACTIVE'';");
    expect(rewrite).toContain("catalog.status <> ''ACTIVE''");
    expect(rewrite).toContain("'key', 'IDENTITY_SIDE_EFFECTS'");
  });
});
