import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010700_app_data_agent_provider_task_validator_grant_repair.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const repairChecksum = "4c38e37bb403a2dbe02494fd7b9919f5dbd773b8a341b0e8c1c3855702b8b16f";

describe("10700 ProviderTask validator grant repair", () => {
  it("is a checksummed forward migration after the analysis authority frontier", () => {
    const zeroed = migration.replaceAll(repairChecksum, "0".repeat(64));
    expect(repairChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migration.split(repairChecksum)).toHaveLength(3);
    expect(createHash("sha256").update(zeroed).digest("hex")).toBe(repairChecksum);
    expect(migration).toContain("20260725010699_app_data_agent_analysis_artifact_authority");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("grants only the transitive validator required by ProviderTask commit", () => {
    expect(migration).toContain(
      "grant execute on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)",
    );
    expect(migration).toContain("to data_agent_provider_invocation_rpc_owner");
    expect(migration).toContain(
      "pg_catalog.has_function_privilege('data_agent_provider_invocation_rpc_owner'",
    );
    expect(migration).toContain(
      "pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner'",
    );
    expect(migration).toContain("pg_catalog.has_function_privilege('data_agent_backend'");
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
  });

  it("preserves the validator owner and its Root Harness call chain", () => {
    expect(migration).toContain("data_agent_u19_team_owner");
    expect(migration).toContain("app_data_agent.command_payload_is_valid(jsonb)");
    expect(migration).toContain("app_data_agent.assert_provider_active_worker_lease(jsonb)");
    expect(migration).toContain("app_data_agent.commit_provider_task_artifact(jsonb,jsonb)");
  });
});
