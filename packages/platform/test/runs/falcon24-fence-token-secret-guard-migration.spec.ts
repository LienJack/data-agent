import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010805_app_data_agent_falcon24_fence_token_secret_guard.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_fence_token_secret_guard_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10805 Falcon24 fence token secret guard", () => {
  it("is rendered, checksummed, forward-only, and chained from exact 10804", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010804_app_data_agent_falcon24_failure_receipt_closure",
    );
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("evolves only the secret detector and preserves its security boundary", () => {
    expect(migration).toContain(
      "create or replace function app_data_agent.contains_potential_plaintext_secret(",
    );
    expect(migration).toContain("'^(snapshot|fence|fencing)_token$'");
    expect(migration).toContain("^bearer[[:space:]]+[^[:space:]]+");
    expect(migration).toContain("^sk-[A-Za-z0-9_-]{12,}");
    expect(migration).toContain("^eyJ[A-Za-z0-9_-]{8,}");
    expect(migration).toContain("PRIVATE KEY-----");
    expect(migration.match(/create or replace function/gu)).toHaveLength(1);
    expect(migration).not.toMatch(/\b(create|alter|drop)\s+table\b/iu);
  });

  it("proves fence tokens are allowed only when they are not credential-shaped", () => {
    expect(migration).toContain("'fence_token'");
    expect(migration).toContain("'fencing_token'");
    expect(migration).toContain("'snapshot_token'");
    expect(migration).toContain("'token'");
    expect(migration).toContain("'Bearer guarded-secret-value'");
    expect(migration).toContain("'sk-guardedSecretValue1234567890'");
    expect(migration).toContain("FALCON24_FENCE_TOKEN_SECRET_GUARD_POSTCONDITION_FAILED");
  });

  it("keeps protected history byte-identical and retains the original owner and grants", () => {
    expect(migration).toContain("falcon24_10805_history_snapshot");
    expect(migration).toContain("FALCON24_FENCE_TOKEN_SECRET_GUARD_HISTORY_DRIFT");
    expect(migration).toContain("owner_name<>'postgres'");
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
    expect(migration).toContain("pg_catalog.has_function_privilege('data_agent_backend'");
    expect(migration).not.toMatch(/delete from app_data_agent\./iu);
    expect(migration).not.toMatch(/update semantic\./iu);
    expect(migration).not.toMatch(/update app_data_agent\./iu);
  });
});
