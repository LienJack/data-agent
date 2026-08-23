import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyMigrationInventory } from "../scripts/lib/workspace-migration-inventory.js";

const root = resolve(import.meta.dirname, "..");
const migrationRoot = resolve(root, "infra/supabase/apps/data-agent/migrations");
const sourceRoot = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10708");
const operatorRepairRoot = resolve(
  root,
  "infra/supabase/apps/data-agent/migration-sources/10722",
);
const migrationName = "20260725010708_app_data_agent_semantic_context_cutover.sql";
const migration = readFileSync(resolve(migrationRoot, migrationName), "utf8");

describe("10708 unique semantic lifecycle cutover", () => {
  it("is the deterministic migration frontier", () => {
    const inventory = verifyMigrationInventory(
      readdirSync(migrationRoot)
        .filter((name) => name.endsWith(".sql"))
        .map((name) => ({ name, sql: readFileSync(resolve(migrationRoot, name), "utf8") })),
    );
    expect(inventory.violations).toEqual([]);
    expect(inventory.frontier).toBe("20260725010724");
    expect(readdirSync(sourceRoot).sort()).toEqual([
      "00-preamble.sql.inc",
      "10-semantic-context-cutover.sql.inc",
      "20-analysis-program-cutover.sql.inc",
      "90-grants-postconditions.sql.inc",
      "99-ledger.sql.inc",
    ]);
  });

  it("renames authority objects and deletes the old runtime surface", () => {
    expect(migration).toContain(
      "alter table app_data_agent.resolved_context_receipts rename to semantic_context_receipts",
    );
    expect(migration).toContain("load_semantic_context_authority_snapshot");
    expect(migration).toContain("commit_semantic_context_package");
    expect(migration).toContain("verify_semantic_context_text2sql_binding");
    expect(migration).toContain("SEMANTIC_CONTEXT_COMPATIBILITY_OBJECT_PRESENT");
    expect(migration).not.toMatch(/create function .*semantic_context.*_(?:v1|v2)\s*\(/i);
    expect(migration).not.toMatch(/backfill|copy.*semantic_context/i);
  });

  it("enforces retrieval, inference and mandatory closure at the authority boundary", () => {
    expect(migration).toContain("semantic-retrieval-receipt@1.0.0");
    expect(migration).toContain("semantic-inference-receipt@1.0.0");
    expect(migration).toContain("SEMANTIC_CONTEXT_MANDATORY_CLOSURE_INVALID");
    expect(migration).toContain(
      "jsonb_array_length(requested#>'{package,mandatory_closure,object_ids}')>80",
    );
    expect(migration).toContain("hard_filter,excluded_objects");
  });

  it("types jsonb object-key subtraction without retaining a parallel commit function", () => {
    const repair = readFileSync(
      resolve(operatorRepairRoot, "20-jsonb-operator-repair.sql.inc"),
      "utf8",
    );
    const postconditions = readFileSync(
      resolve(operatorRepairRoot, "90-postconditions.sql.inc"),
      "utf8",
    );

    expect(repair).toContain("commit_semantic_context_package(jsonb)");
    expect(repair).toContain("'receipt_hash'::text");
    expect(repair).not.toMatch(/create\s+(?:or\s+replace\s+)?function/i);
    expect(postconditions).toContain("SEMANTIC_CONTEXT_JSONB_OPERATOR_REPAIR_NOT_INSTALLED");
  });

  it("projects safe commit rejection codes without adding a compatibility entrypoint", () => {
    const diagnostics = readFileSync(
      resolve(
        root,
        "infra/supabase/apps/data-agent/migration-sources/10723/20-commit-diagnostics.sql.inc",
      ),
      "utf8",
    );

    expect(diagnostics).toContain("SEMANTIC_CONTEXT_RETRIEVAL_RECEIPT_HASH_INVALID");
    expect(diagnostics).toContain("SEMANTIC_CONTEXT_MANDATORY_CLOSURE_HASH_INVALID");
    expect(diagnostics).not.toMatch(/create\s+(?:or\s+replace\s+)?function/i);
  });

  it("validates persisted identifiers before PostgreSQL casts", () => {
    const validation = readFileSync(
      resolve(
        root,
        "infra/supabase/apps/data-agent/migration-sources/10724/20-persistence-input-validation.sql.inc",
      ),
      "utf8",
    );

    expect(validation).toContain("pg_catalog.pg_input_is_valid");
    expect(validation).toContain("SEMANTIC_CONTEXT_PACKAGE_ID_INVALID");
    expect(validation).toContain("SEMANTIC_CONTEXT_RESOLVED_AT_INVALID");
    expect(validation).not.toMatch(/create\s+(?:or\s+replace\s+)?function/i);
  });

  it("accepts AnalysisProgram only in the active artifact authority", () => {
    const cutover = migration.slice(migration.indexOf("do $analysis_program_rpc$"));
    const policies = cutover.slice(
      cutover.indexOf("create policy artifacts_u6_reserved_insert_deny"),
    );
    expect(cutover).toContain("AnalysisProgram");
    expect(cutover).toContain("ANALYSIS_PROGRAM_CUTOVER_INCOMPLETE");
    expect(policies).not.toMatch(/'AnalysisPlan'\s*,/);
  });
});
