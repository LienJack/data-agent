import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10794");
const migrationPath = resolve(
  root,
  "infra/supabase/apps/data-agent/migrations/20260725010794_app_data_agent_falcon24_semantic_dependency_provisioning.sql",
);

function source(name: string): string {
  return readFileSync(resolve(sourceDirectory, name), "utf8");
}

describe("10794 Falcon24 semantic dependency provisioning migration", () => {
  it("targets only exact E3 generation-1 Falcon24 authority with an empty E4 write domain", () => {
    const provisioning = source("20-semantic-dependency-provisioning.sql.inc");

    expect(provisioning).toContain("current_epoch.authority_epoch='E3'");
    expect(provisioning).toContain("active_pointer.current_release_generation=1");
    expect(provisioning).toContain("registry.semantic_domain='falcon24'");
    expect(provisioning).toContain("FALCON24_SEMANTIC_DEPENDENCY_E4_POLLUTED");
    expect(provisioning).toContain("semantic.semantic_successor_release_stage");
    expect(provisioning).toContain("app_data_agent.falcon24_diagnostic_attempts");
  });

  it("derives the missing dependency closure from immutable generation-1 bootstrap evidence", () => {
    const provisioning = source("20-semantic-dependency-provisioning.sql.inc");

    expect(provisioning).toContain("semantic.semantic_bootstrap_validation_receipts");
    expect(provisioning).toContain("semantic.initial_semantic_release_sets");
    expect(provisioning).toContain("semantic.semantic_bootstrap_policy_pointer");
    expect(provisioning).toContain("semantic.semantic_bootstrap_policy_revisions");
    expect(provisioning).toContain("semantic.semantic_runtime_restriction_projection");
    expect(provisioning).toContain("semantic.semantic_relationship_projection");
    expect(provisioning).toContain("schema_snapshot,snapshot_hash");
    expect(provisioning).toContain("app_data_agent.u2_canonical_sha256(");
    expect(provisioning).toContain("validation.receipt_json-'receipt_hash'");
  });

  it("inserts only the missing catalog fence and dependency pointer and rejects partial state", () => {
    const provisioning = source("20-semantic-dependency-provisioning.sql.inc");

    expect(provisioning).toContain("FALCON24_SEMANTIC_DEPENDENCY_PARTIAL_STATE");
    expect(provisioning).toContain("insert into semantic.semantic_catalog_fence");
    expect(provisioning).toContain("insert into semantic.semantic_dependency_pointer");
    expect(provisioning).not.toMatch(
      /(?:update|delete\s+from)\s+(?:semantic\.semantic_source_release|semantic\.semantic_active_pointer|semantic\.semantic_runtime_activation|app_data_agent\.workspace_run_defaults|app_data_agent\.falcon24_)/iu,
    );
  });

  it("fails closed unless pointer, fence, compiler, policy, and bootstrap evidence form one closure", () => {
    const postconditions = source("90-postconditions.sql.inc");

    expect(postconditions).toContain("pointer.current_catalog_epoch is distinct from 0");
    expect(postconditions).toContain(
      "pointer.current_catalog_digest is distinct from fence.catalog_digest",
    );
    expect(postconditions).toContain(
      "pointer.current_compiler_bundle_digest is distinct from release.compiler_bundle_digest",
    );
    expect(postconditions).toContain(
      "pointer.current_closure_policy_digest is distinct from policy.policy_hash",
    );
    expect(postconditions).toContain("FALCON24_SEMANTIC_DEPENDENCY_POSTCONDITION_FAILED");
  });

  it("renders one checksum-bound forward migration", () => {
    const rendered = readFileSync(migrationPath, "utf8");

    expect(rendered).toContain("falcon24_semantic_dependency_provisioning_migration_checksum");
    expect(rendered).toContain(
      "20260725010794_app_data_agent_falcon24_semantic_dependency_provisioning",
    );
    expect(rendered).not.toContain(
      "__FALCON24_SEMANTIC_DEPENDENCY_PROVISIONING_MIGRATION_CHECKSUM__",
    );
  });
});
