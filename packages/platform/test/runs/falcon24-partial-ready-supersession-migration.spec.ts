import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const path = resolve(
  import.meta.dirname,
  "../../../../infra/supabase/apps/data-agent/migrations/20260725010812_app_data_agent_falcon24_partial_ready_supersession.sql",
);
const migration = existsSync(path) ? readFileSync(path, "utf8") : "";

describe("10812 partial READY attempt supersession", () => {
  it("chains from exact 10811 with a canonical migration checksum", () => {
    const hash =
      /^-- falcon24_partial_ready_supersession_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
        migration,
      )?.[1] ?? "";
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(migration.split(hash)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(hash, "0".repeat(64)))
        .digest("hex"),
    ).toBe(hash);
    expect(migration).toContain("20260725010811_app_data_agent_falcon24_root_agent_public_event");
  });

  it("allows only a verified PASSED prefix and pristine PLANNED suffix with no in-flight turn", () => {
    for (const text of [
      "attempt.status<>'READY'",
      "passed_turn_count<>attempt.next_turn_ordinal",
      "planned_turn_count<>15-attempt.next_turn_ordinal",
      "row.turn_ordinal<attempt.next_turn_ordinal",
      "row.turn_ordinal>=attempt.next_turn_ordinal",
      "row.status='PASSED'",
      "row.status='PLANNED'",
      "row.terminal_receipt->>'status'='PASS'",
      "row.run_id is null",
      "expected_attempt_version",
      "for update",
      "pg_catalog.pg_advisory_xact_lock",
    ]) {
      expect(migration).toContain(text);
    }
    expect(migration).toContain("FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED");
    expect(migration).toContain("new.next_turn_ordinal=old.next_turn_ordinal");
  });

  it("preserves immutable rows and exact function ownership and denies browser or raw DML bypass", () => {
    expect(migration).toContain("falcon24_10812_history_snapshot");
    expect(migration).toContain("FALCON24_PARTIAL_SUPERSESSION_HISTORY_DRIFT");
    expect(migration).toContain("owner to data_agent_u6_rpc_owner");
    expect(migration).toContain("set search_path=''");
    expect(migration).toContain("revoke all on function");
    expect(migration).not.toMatch(
      /(?:update|delete from) app_data_agent\.falcon24_four_layer_gate_turns/iu,
    );
    expect(migration).not.toMatch(/disable trigger|session_replication_role|grant all/iu);
  });

  it("rejects null protocol, reason, hash, and CAS fields at the SQL boundary", () => {
    expect(migration).toContain("command->>'schema_version' is distinct from");
    expect(migration).toContain("command->>'command_hash' is distinct from");
    expect(migration).toContain(
      "(command->>'expected_attempt_version'~'^[1-9][0-9]*$') is distinct from true",
    );
    expect(migration).toContain("command->>'reason_code' is distinct from");
  });
});
