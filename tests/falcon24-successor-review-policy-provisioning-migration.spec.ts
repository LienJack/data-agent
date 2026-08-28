import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10793");
const migrationPath = resolve(
  root,
  "infra/supabase/apps/data-agent/migrations/20260725010793_app_data_agent_falcon24_successor_review_policy_provisioning.sql",
);

function source(name: string): string {
  return readFileSync(resolve(sourceDirectory, name), "utf8");
}

describe("10793 Falcon24 successor review policy provisioning migration", () => {
  it("provisions only exact E3 generation-1 Falcon24 scopes with no partial policy", () => {
    const provisioning = source("20-review-policy-provisioning.sql.inc");

    expect(provisioning).toContain("current_epoch.authority_epoch='E3'");
    expect(provisioning).toContain("pointer.current_release_generation=1");
    expect(provisioning).toContain("registry.semantic_domain='falcon24'");
    expect(provisioning).toContain("FALCON24_SUCCESSOR_REVIEW_POLICY_PARTIAL_STATE");
    expect(provisioning).toContain("semantic.semantic_successor_review_preparation");
  });

  it("derives one current owner reviewer and computes the policy digest in PostgreSQL", () => {
    const provisioning = source("20-review-policy-provisioning.sql.inc");

    expect(provisioning).toContain("app_data_agent.memberships");
    expect(provisioning).toContain("membership.membership_role='owner'");
    expect(provisioning).toContain("membership.revoked_at is null");
    expect(provisioning).toContain("FALCON24_SUCCESSOR_REVIEW_POLICY_OWNER_INVALID");
    expect(provisioning).toContain("app_data_agent.u2_canonical_sha256(policy_payload)");
    expect(provisioning).toContain("pg_catalog.decode('00','hex')");
    expect(provisioning).not.toContain("pg_catalog.chr(0)");
    expect(provisioning).not.toContain("00000000-0000-4000-8000-00000000e125");
  });

  it("creates a one-human quorum without mutating protected Falcon or generation-1 rows", () => {
    const provisioning = source("20-review-policy-provisioning.sql.inc");

    expect(provisioning).toContain("'required_approvals',1");
    expect(provisioning).toContain("'proposer_cannot_approve',true");
    expect(provisioning).toContain("'require_author_exclusion',true");
    expect(provisioning).toContain("semantic.semantic_reviewer_policy_revision");
    expect(provisioning).toContain("semantic.semantic_reviewer_assignment");
    expect(provisioning).toContain("semantic.semantic_reviewer_policy_pointer");
    expect(provisioning).not.toMatch(
      /(?:update|delete\s+from)\s+(?:semantic\.semantic_source_release|semantic\.semantic_active_pointer|app_data_agent\.falcon24_)/iu,
    );
  });

  it("fails closed unless the resulting policy, pointer, and assignment form one exact closure", () => {
    const postconditions = source("90-postconditions.sql.inc");

    expect(postconditions).toContain("app_data_agent.u2_canonical_sha256(policy.policy_payload)");
    expect(postconditions).toContain(
      "policy.policy_digest is distinct from pointer.current_policy_digest",
    );
    expect(postconditions).toContain(
      "assignment.policy_version is distinct from policy.policy_version",
    );
    expect(postconditions).not.toContain("pg_catalog.coalesce(");
    expect(postconditions).toContain("FALCON24_SUCCESSOR_REVIEW_POLICY_POSTCONDITION_FAILED");
  });

  it("renders one checksum-bound forward migration", () => {
    const rendered = readFileSync(migrationPath, "utf8");

    expect(rendered).toContain("falcon24_successor_review_policy_provisioning_migration_checksum");
    expect(rendered).toContain(
      "20260725010793_app_data_agent_falcon24_successor_review_policy_provisioning",
    );
    expect(rendered).not.toContain(
      "__FALCON24_SUCCESSOR_REVIEW_POLICY_PROVISIONING_MIGRATION_CHECKSUM__",
    );
  });
});
