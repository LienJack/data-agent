import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010701_app_data_agent_legacy_profile_list_runtime_repair.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const repairChecksum = "46d0334725b021afc286e4e5aed2e916aecf0a5b78c7ec72725433525f06937a";

describe("10701 legacy Profile list runtime repair", () => {
  it("is a checksummed forward migration after the ProviderTask grant repair", () => {
    const zeroed = migration.replaceAll(repairChecksum, "0".repeat(64));
    expect(repairChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migration.split(repairChecksum)).toHaveLength(3);
    expect(createHash("sha256").update(zeroed).digest("hex")).toBe(repairChecksum);
    expect(migration).toContain(
      "20260725010700_app_data_agent_provider_task_validator_grant_repair",
    );
  });

  it("projects the latest v1 runtime profile behind each enabled v2 head", () => {
    expect(migration).toContain(
      "create or replace function app_data_agent.list_agent_profile_revisions",
    );
    expect(migration).toContain("agent-product-profile-revision@1.0.0");
    expect(migration).toContain("join lateral");
    expect(migration).toContain("order by candidate.revision desc");
    expect(migration).toContain("'active_revision', revision.revision");
    expect(migration).toContain("'active_revision_hash', revision.revision_hash");
  });

  it("preserves scope, signer-revocation, owner, and ACL closure", () => {
    expect(migration).toContain("platform.current_backend_authority(false)");
    expect(migration).toContain("skill_signer_revocations");
    expect(migration).toContain("owner to data_agent_u20_profile_owner");
    expect(migration).toContain("to data_agent_u20_profile_owner, data_agent_backend");
    expect(migration).toContain("pg_catalog.has_function_privilege(\n      'public'");
  });
});
