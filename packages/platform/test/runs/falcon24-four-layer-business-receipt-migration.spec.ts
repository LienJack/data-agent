import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010808_app_data_agent_falcon24_business_receipt_coalesce_repair.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_business_receipt_coalesce_repair_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10808 Falcon24 business receipt coalesce repair", () => {
  it("is checksummed and chained from exact 10807", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010807_app_data_agent_falcon24_four_layer_conversation_grant",
    );
  });

  it("repairs only the schema-qualified coalesce in business receipt persistence", () => {
    expect(migration).toContain(
      "app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)",
    );
    expect(migration).toContain("broken_expression constant text := 'pg_catalog.coalesce('");
    expect(migration).toContain("fixed_expression constant text := 'coalesce('");
    expect(migration).toContain(
      "pg_catalog.replace(definition,broken_expression,fixed_expression)",
    );
    expect(migration).toContain("FALCON24_BUSINESS_RECEIPT_COALESCE_SOURCE_MISMATCH");
    expect(migration).toContain("FALCON24_BUSINESS_RECEIPT_COALESCE_POSTCONDITION_FAILED");
  });

  it("preserves protected history and existing execute grants", () => {
    expect(migration).toContain("falcon24_10808_history_snapshot");
    expect(migration).toContain("FALCON24_BUSINESS_RECEIPT_COALESCE_HISTORY_DRIFT");
    expect(migration).toContain("data_agent_backend");
    expect(migration).toContain("data_agent_u6_rpc_owner");
    expect(migration).toContain("or pg_catalog.has_function_privilege('public'");
    expect(migration).not.toMatch(/delete from app_data_agent\./iu);
    expect(migration).not.toMatch(/update app_data_agent\./iu);
    expect(migration).not.toMatch(/insert into app_data_agent\./iu);
    expect(migration).not.toMatch(/alter table app_data_agent\./iu);
  });
});
