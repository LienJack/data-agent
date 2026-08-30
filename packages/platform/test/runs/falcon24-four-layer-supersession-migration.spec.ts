import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010810_app_data_agent_falcon24_ready_attempt_supersession.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_ready_attempt_supersession_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10810 Falcon24 unused READY attempt supersession", () => {
  it("is checksummed and chained from exact 10809", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010809_app_data_agent_falcon24_turn_finalization_coalesce_repair",
    );
  });

  it("allows only an unused READY attempt to become an explicit build-superseded failure", () => {
    expect(migration).toContain(
      "create function app_data_agent.supersede_falcon24_four_layer_gate_attempt(command jsonb)",
    );
    expect(migration).toContain("attempt.status<>'READY'");
    expect(migration).toContain("attempt.next_turn_ordinal<>0");
    expect(migration).toContain("row.status<>'PLANNED'");
    expect(migration).toContain("row.run_id is not null");
    expect(migration).toContain("FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED");
    expect(migration).toContain("FALCON24_FOUR_LAYER_SUPERSEDE_INVALID");
    expect(migration).toContain("expected_attempt_version");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain(
      "'data-agent:falcon24-four-layer-attempt:'||(command->>'attempt_id')",
    );
    expect(migration).toContain("for update");
  });

  it("preserves every Turn and existing attempt identity while retaining server-only mutation", () => {
    expect(migration).toContain("falcon24_10810_turn_history_snapshot");
    expect(migration).toContain("FALCON24_READY_SUPERSESSION_TURN_HISTORY_DRIFT");
    expect(migration).toContain("owner to data_agent_u6_rpc_owner");
    expect(migration).toContain("revoke all on function");
    expect(migration).toContain("grant execute on function");
    expect(migration).not.toMatch(/delete from app_data_agent\./iu);
    expect(migration).not.toMatch(/update app_data_agent\.falcon24_four_layer_gate_turns/iu);
  });
});
