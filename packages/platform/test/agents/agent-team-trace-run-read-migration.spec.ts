import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../../infra/supabase/apps/data-agent/migrations/20260725010813_app_data_agent_agent_team_trace_run_read.sql",
  ),
  "utf8",
);

describe("10813 exact-owner Team trace read", () => {
  it("binds reviewed bytes and the exact predecessor", () => {
    const checksum =
      /^-- agent_team_trace_run_read_migration_checksum: sha256:([a-f0-9]{64})/u.exec(
        migration,
      )?.[1];
    expect(checksum).toBeDefined();
    if (!checksum) throw new Error("checksum missing");
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010812_app_data_agent_falcon24_partial_ready_supersession",
    );
  });
  it("adds only exact-principal SELECT without a new writer or rewriting frozen RPCs", () => {
    expect(migration).toContain(
      "create policy runs_team_trace_owner_select on app_data_agent.runs for select",
    );
    expect(migration).toContain("app_id,tenant_id,environment,principal_id,false");
    expect(migration).toContain(
      "grant execute on function platform.backend_exact_principal_object_matches",
    );
    expect(migration).not.toMatch(
      /create (or replace )?function|alter role|grant (insert|update|delete|data_agent_backend)|(?:update|delete from|insert into) app_data_agent\./iu,
    );
    expect(migration).toContain("AGENT_TEAM_TRACE_RUN_READ_HISTORY_DRIFT");
    expect(migration).toContain("not rolbypassrls");
  });
});
