import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010786_app_data_agent_conversation_context_summary_compatibility.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- conversation_context_summary_compatibility_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10786 ProviderTask summary compatibility", () => {
  it("is an immutable forward repair chained after 10785", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010785_app_data_agent_conversation_context_summary");
    expect(migration).not.toMatch(/create table|alter table/iu);
  });

  it("keeps summary selection exact for Root leases and preserves legacy lease behavior", () => {
    expect(migration).toContain("requested_lease#>'{payload,visible_message_refs}' is null then 1");
    expect(migration).toContain("requested_lease#>'{payload,visible_message_refs}' is not null");
    expect(migration).toContain("left join app_data_agent.effective_run_config_receipts receipt");
    expect(migration).toContain("conversation.resource_version=");
    expect(migration).toContain("receipt.config_id is not null");
    expect(migration).toContain("for share of binding,message,event,conversation");
    expect(migration).toContain(
      "selected_message_refs<>requested_lease#>'{payload,visible_message_refs}'",
    );
    expect(migration).toContain(
      "grant usage on schema extensions\nto data_agent_provider_invocation_rpc_owner",
    );
    expect(migration).not.toContain("grant usage on schema extensions\nto data_agent_backend");
    expect(migration).toContain("CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_PATCH_DRIFT");
  });
});
