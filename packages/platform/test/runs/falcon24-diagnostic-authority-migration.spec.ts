import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010790_app_data_agent_falcon24_diagnostic_authority.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_diagnostic_authority_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10790 Falcon24 E4 diagnostic authority", () => {
  it("is a rendered forward-only PostgreSQL 17 migration", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010789_app_data_agent_semantic_context_canonical_aliases");
  });

  it("keeps attempts append-only and permits only ACTIVE to terminal transitions", () => {
    expect(migration).toContain("create table app_data_agent.falcon24_diagnostic_attempts");
    expect(migration).toContain("create table app_data_agent.falcon24_diagnostic_receipts");
    expect(migration).toContain("falcon24_diagnostic_one_active_closure");
    expect(migration).toContain("old.status<>'ACTIVE'");
    expect(migration).toContain("new.status not in('PASSED','FAILED')");
    expect(migration).not.toMatch(/delete from app_data_agent\.falcon24_diagnostic/iu);
  });

  it("requires exact E4 generation 2 authority, browser UI evidence, and residual zero", () => {
    expect(migration).toContain("manifest#>>'{authority,authority_epoch}'<>'E4'");
    expect(migration).toContain("semantic_release->>'generation'<>'2'");
    expect(migration).toContain("row.receipt_kind='QA_E2E'");
    expect(migration).toContain("row.receipt_kind='TRACE_UI'");
    expect(migration).toContain("opened_artifact_refs");
    expect(migration).toContain("falcon24-sandbox-reclamation-receipt@3.0.0");
    expect(migration).toContain("reclamation->>'residual'<>'0'");
  });

  it("makes PASSED diagnostic evidence a database prerequisite for E4-Q1", () => {
    expect(migration).toContain("falcon24-qualification-manifest@3.0.0");
    expect(migration).toContain("FALCON24_QUALIFICATION_DIAGNOSTIC_REQUIRED");
    expect(migration).toContain("diagnostic.status is distinct from 'PASSED'");
    expect(migration).toContain("diagnostic_receipt.outcome is distinct from 'PASS'");
    expect(migration).toContain("falcon24_qualification_diagnostic_receipt_fk");
  });

  it("exposes only RPCs to backend and hides the pre-diagnostic mutator", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain("to data_agent_u6_rpc_owner");
    expect(migration).toContain(
      "revoke execute on function app_data_agent.begin_falcon24_qualification_pre_diagnostic",
    );
    expect(migration).toContain("from data_agent_backend");
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
  });
});
