import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010789_app_data_agent_semantic_context_canonical_aliases.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- semantic_context_canonical_aliases_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10789 Semantic Context canonical aliases", () => {
  it("is an immutable forward migration chained after 10788", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010788_app_data_agent_root_default_policy_compatibility");
    expect(migration).not.toMatch(/create table|alter table|update\s|delete\s/iu);
  });

  it("normalizes aliases at both projection paths without mutating releases", () => {
    expect(migration).toContain("semantic_context_metric_projection(uuid,uuid,text,text,uuid)");
    expect(migration).toContain("semantic_context_ontology_projection(uuid,uuid,text,text,uuid)");
    expect(migration).toContain("select distinct element.value#>>'{}' value");
    expect(migration).toContain("pg_catalog.jsonb_agg(to_jsonb(alias.value) order by alias.value)");
    expect(migration).toContain("SEMANTIC_CONTEXT_CANONICAL_ALIASES_POSTCONDITION_FAILED");
  });
});
