import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "infra/supabase/apps/data-agent/migrations/20260725010697_app_data_agent_agent_team_trace_content.sql",
  ),
  "utf8",
);
const checksum = "d858b3ee13a3d984cd45a5e211fefdaecabae085c5a15d7831c15409eb0bd4bc";

describe("10697 Agent Team content-first trace projection", () => {
  it("is ledger-bound to the exact reviewed migration bytes", () => {
    const zeroed = migration.replaceAll(checksum, "0".repeat(64));
    expect(migration.split(checksum)).toHaveLength(3);
    expect(createHash("sha256").update(zeroed).digest("hex")).toBe(checksum);
    expect(migration).toContain("20260725010696_app_data_agent_model_driven_subagent_harness");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("keeps v1 relational/document/hash verification as the fail-closed boundary", () => {
    expect(migration).toContain(
      "verified_v1 := app_data_agent.load_agent_team_public_projection(requested_run_id)",
    );
    expect(migration).toContain("if verified_v1 is null then");
    expect(migration).toContain("platform.current_backend_authority(false)");
  });

  it("projects only the reviewed public content allowlist", () => {
    for (const field of [
      "goal_revision",
      "required_artifact_types",
      "artifact_refs",
      "obligation_counts",
      "dimensions",
      "semantic_status",
      "accepted_at",
    ]) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).not.toMatch(/reasoning_content|system_prompt|provider_payload|secret_ref/i);
  });

  it("keeps the RPC owner scoped and unavailable to public", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("owner to data_agent_u19_team_owner");
    expect(migration).not.toContain("owner to data_agent_owner");
    expect(migration).toContain(
      "revoke all on function app_data_agent.load_agent_team_public_projection_v2(uuid) from public",
    );
    expect(migration).toContain("to data_agent_backend");
  });
});
