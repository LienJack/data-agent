import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010702_app_data_agent_semantic_explorer_projection_reuse_repair.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const repairChecksum = "54b6bbc05e5142685a5824836fbf47211bbcebc428511b447a6b388a163b28f3";

describe("10702 Semantic Explorer projection reuse repair", () => {
  it("is a checksummed forward migration after the legacy Profile repair", () => {
    const zeroed = migration.replaceAll(repairChecksum, "0".repeat(64));
    expect(migration.split(repairChecksum)).toHaveLength(3);
    expect(createHash("sha256").update(zeroed).digest("hex")).toBe(repairChecksum);
    expect(migration).toContain("20260725010701_app_data_agent_legacy_profile_list_runtime_repair");
  });

  it("removes only release-row identity checks from both Explorer readers", () => {
    expect(migration).toContain(
      "semantic.build_explorer_source(uuid,uuid,text,uuid,text,uuid,text)",
    );
    expect(migration).toContain(
      "semantic.build_explorer_release_identity(uuid,uuid,text,text,uuid)",
    );
    expect(migration).toContain("v_executable\\.release_id");
    expect(migration).toContain("v_relationship\\.release_id");
    expect(migration).toContain("v_restriction\\.release_id");
  });

  it("retains exact projection reference and digest postconditions", () => {
    expect(migration).toContain(
      "v_executable.projection_digest is distinct from v_release.executable_projection_hash",
    );
    expect(migration).toContain(
      "v_relationship.projection_digest is distinct from v_release.relationship_projection_hash",
    );
    expect(migration).toContain(
      "v_restriction.projection_digest is distinct from v_release.runtime_restriction_projection_hash",
    );
  });
});
