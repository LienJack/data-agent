import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010698_app_data_agent_subagent_harness_runtime_repair.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const immutable10696 = readFileSync(
  resolve(
    repositoryRoot,
    "infra/supabase/apps/data-agent/migrations/20260725010696_app_data_agent_model_driven_subagent_harness.sql",
  ),
  "utf8",
);
const immutable10696Checksum = "8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2";
const runtimeRepairChecksum = "4ed26320816c7bd3a06133c5c67322e5d8d0cf26c84e3198754660af7482faaa";

describe("10698 Subagent Harness runtime repair", () => {
  it("preserves the already-applied 10696 migration bytes", () => {
    const zeroed = immutable10696.replaceAll(immutable10696Checksum, "0".repeat(64));
    expect(immutable10696.split(immutable10696Checksum)).toHaveLength(3);
    expect(createHash("sha256").update(zeroed).digest("hex")).toBe(immutable10696Checksum);
  });

  it("is a fail-closed forward migration after 10697", () => {
    const zeroed = migration.replaceAll(runtimeRepairChecksum, "0".repeat(64));
    expect(migration.split(runtimeRepairChecksum)).toHaveLength(3);
    expect(createHash("sha256").update(zeroed).digest("hex")).toBe(runtimeRepairChecksum);
    expect(migration).toContain("20260725010697_app_data_agent_agent_team_trace_content");
    expect(migration).toContain(`sha256:${immutable10696Checksum}`);
    expect(migration).toContain("server_version_num");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("grants only the required transitive validator execution", () => {
    expect(migration).toContain(
      "grant execute on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)",
    );
    expect(migration).toContain("to data_agent_effective_config_rpc_owner");
    expect(migration).toContain(
      "pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner'",
    );
    expect(migration).toContain("pg_catalog.has_function_privilege('data_agent_backend'");
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
  });

  it("forwards profile revocation and visible-message validation", () => {
    expect(migration).toContain("skill_signer_revocations");
    expect(migration).toContain("visible_message_refs");
    expect(migration).toContain("effective-config-team-lease@3.0.0");
  });
});
