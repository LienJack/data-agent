import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010791_app_data_agent_falcon24_semantic_closure_readback.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_semantic_closure_readback_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10791 Falcon24 semantic closure readback", () => {
  it("is a rendered forward-only PostgreSQL 17 migration", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010790_app_data_agent_falcon24_diagnostic_authority");
  });

  it("loads authority, semantic pointers, and defaults through one refs-only RPC", () => {
    expect(migration).toContain(
      "function app_data_agent.load_falcon24_semantic_authority_closure(command jsonb)",
    );
    expect(migration).toContain("falcon24-semantic-authority-closure-load@1.0.0");
    expect(migration).toContain("falcon24-semantic-authority-closure@1.0.0");
    expect(migration).toContain("pointer.pointer_generation");
    expect(migration).toContain("runtime.activation_generation");
    expect(migration).toContain("defaults_pointer.defaults_revision");
    expect(migration).not.toContain("projection_payload");
  });

  it("rejects mixed releases and exposes no direct table reads to backend", () => {
    expect(migration).toContain("FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID");
    expect(migration).toContain(
      "pointer_release.release_id is distinct from runtime_release.release_id",
    );
    expect(migration).toContain(
      "pointer_release.release_id is distinct from defaults_release.release_id",
    );
    expect(migration).toContain(
      "grant execute on function app_data_agent.load_falcon24_semantic_authority_closure(jsonb)",
    );
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
    expect(migration).toContain("pg_catalog.has_table_privilege('data_agent_backend'");
  });
});
