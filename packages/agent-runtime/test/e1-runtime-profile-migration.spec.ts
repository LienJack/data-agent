import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_PROFILE_REVISIONS } from "../src/teams/agent-profiles.js";

const migrationPath = fileURLToPath(
  new URL(
    "../../../infra/supabase/apps/data-agent/migrations/20260725010780_app_data_agent_falcon24_e1_runtime_profile.sql",
    import.meta.url,
  ),
);

describe("Falcon24 E1 runtime profile migration", () => {
  it("installs the exact source-owned semantic read profile", () => {
    const profile = AGENT_PROFILE_REVISIONS.find(
      (candidate) =>
        candidate.profile_id === "semantic-management-agent" && candidate.revision === 3,
    );
    if (!profile) throw new TypeError("missing historical E1 semantic profile");
    const migration = readFileSync(migrationPath, "utf8");

    expect(profile).toMatchObject({
      revision: 3,
      direct_tool_allowlist: ["semantic.catalog.read"],
      expected_output_artifact_types: ["AnalysisReport"],
    });
    expect(migration).toContain(`'${JSON.stringify(profile)}'::jsonb`);
    expect(migration).toContain(`'${profile.profile_hash}'`);
  });
});
