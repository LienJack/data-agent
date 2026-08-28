import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10796");
const migrationPath = resolve(
  root,
  "infra/supabase/apps/data-agent/migrations/20260725010796_app_data_agent_semantic_successor_smoke_revalidation.sql",
);

function source(name: string): string {
  return readFileSync(resolve(sourceDirectory, name), "utf8");
}

describe("10796 semantic successor smoke revalidation migration", () => {
  it("requires exact 10795 and snapshots existing stage plus receipt bytes", () => {
    const preamble = source("00-preamble.sql.inc");

    expect(preamble).toContain("20260725010795_app_data_agent_falcon24_authority_staging_hold");
    expect(preamble).toContain(
      "sha256:6a367834c337db45823104c28e4ecc2445b3ab73270fb0bbf766a20aad4f6d9d",
    );
    expect(preamble).toContain("semantic_10796_successor_history_snapshot");
    expect(preamble).toContain("semantic.semantic_successor_release_stage");
    expect(preamble).toContain("semantic.semantic_successor_stage_receipt");
  });

  it("appends only PASS revalidation receipts for an already smoke-passed stage", () => {
    const rpc = source("20-smoke-revalidation-rpc.sql.inc");

    expect(rpc).toContain("create or replace function semantic.commit_semantic_successor_smoke");
    expect(rpc).toContain("stage.status not in('STAGED','SMOKE_PASSED')");
    expect(rpc).toContain("stage.status='SMOKE_PASSED' and receipt->>'outcome'<>'PASS'");
    expect(rpc).toContain("stage.status='STAGED' and receipt->>'outcome'='PASS'");
    expect(rpc).toContain("stage.status='STAGED' and receipt->>'outcome'='FAIL'");
    expect(rpc).not.toMatch(
      /(?:update|delete\s+from)\s+semantic\.semantic_successor_stage_receipt/iu,
    );
  });

  it("keeps the RPC capability-gated and proves migration-time history preservation", () => {
    const security = source("80-security.sql.inc");
    const postconditions = source("90-postconditions.sql.inc");

    expect(security).toContain("owner to data_agent_u6_rpc_owner");
    expect(security).toContain("from public");
    expect(security).toContain("to data_agent_backend");
    expect(postconditions).toContain("SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_POSTCONDITION_FAILED");
    expect(postconditions).toContain("semantic_10796_successor_history_snapshot");
    expect(postconditions).toContain("has_function_privilege");
  });

  it("renders one checksum-bound forward migration", () => {
    const rendered = readFileSync(migrationPath, "utf8");

    expect(rendered).toContain("semantic_successor_smoke_revalidation_migration_checksum");
    expect(rendered).toContain(
      "20260725010796_app_data_agent_semantic_successor_smoke_revalidation",
    );
    expect(rendered).not.toContain("__SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_MIGRATION_CHECKSUM__");
  });
});
