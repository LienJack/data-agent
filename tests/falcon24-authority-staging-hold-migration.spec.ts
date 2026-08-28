import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10795");
const migrationPath = resolve(
  root,
  "infra/supabase/apps/data-agent/migrations/20260725010795_app_data_agent_falcon24_authority_staging_hold.sql",
);

function source(name: string): string {
  return readFileSync(resolve(sourceDirectory, name), "utf8");
}

describe("10795 Falcon24 pre-baseline staging HOLD migration", () => {
  it("requires the exact 10794 predecessor and snapshots staging bytes before DDL", () => {
    const preamble = source("00-preamble.sql.inc");

    expect(preamble).toContain(
      "20260725010794_app_data_agent_falcon24_semantic_dependency_provisioning",
    );
    expect(preamble).toContain(
      "sha256:052c07b894b5ce6468e2b368122f67d1a9d983fcb99d1e57c16fe92901f85219",
    );
    expect(preamble).toContain("falcon24_10795_staging_snapshot");
    expect(preamble).toContain("app_data_agent.falcon24_authority_staging_sessions");
  });

  it("holds only the exact successor session before any baseline exists", () => {
    const rpc = source("20-staging-hold-rpc.sql.inc");

    expect(rpc).toContain("hold_falcon24_authority_staging_session(command jsonb)");
    expect(rpc).toContain("falcon24-staging-hold-request@2.0.0");
    expect(rpc).toContain("expected_retained_assets_hash");
    expect(rpc).toContain("FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR");
    expect(rpc).toContain("for update");
    expect(rpc).toContain("FALCON24_AUTHORITY_STAGING_HOLD_BASELINE_EXISTS");
    expect(rpc).toContain("status='HOLD',failure_code=command->>'failure_code'");
    expect(rpc).toContain("FALCON24_AUTHORITY_STAGING_HOLD_CONFLICT");
    expect(rpc).not.toMatch(
      /(?:update|delete\s+from)\s+app_data_agent\.(?:falcon24_authority_staging_receipts|falcon24_authority_baselines|falcon24_authority_activation_attempts|falcon24_current_authority_epoch)/iu,
    );
  });

  it("exposes only the capability-gated RPC and proves existing staging bytes are unchanged", () => {
    const security = source("80-security.sql.inc");
    const postconditions = source("90-postconditions.sql.inc");

    expect(security).toContain("owner to data_agent_u6_rpc_owner");
    expect(security).toContain("from public");
    expect(security).toContain("to data_agent_backend");
    expect(postconditions).toContain("FALCON24_STAGING_HOLD_POSTCONDITION_FAILED");
    expect(postconditions).toContain("falcon24_10795_staging_snapshot");
    expect(postconditions).toContain("has_function_privilege");
  });

  it("renders one checksum-bound forward migration", () => {
    const rendered = readFileSync(migrationPath, "utf8");

    expect(rendered).toContain("falcon24_authority_staging_hold_migration_checksum");
    expect(rendered).toContain("20260725010795_app_data_agent_falcon24_authority_staging_hold");
    expect(rendered).not.toContain("__FALCON24_AUTHORITY_STAGING_HOLD_MIGRATION_CHECKSUM__");
  });
});
