import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010803_app_data_agent_falcon24_four_layer_gate.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_four_layer_gate_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(migration)?.[1];

describe("10803 Falcon24 four-layer gate authority", () => {
  it("is rendered, checksummed, forward-only, and based on exact 10802", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010802_app_data_agent_falcon24_e10_versioned_profile_authority",
    );
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("adds one scoped attempt/turn authority without mutating 16+30 history", () => {
    expect(migration).toContain("create table app_data_agent.falcon24_four_layer_gate_attempts");
    expect(migration).toContain("create table app_data_agent.falcon24_four_layer_gate_turns");
    expect(migration).toContain("falcon24_10803_history_snapshot");
    expect(migration).toContain("FALCON24_FOUR_LAYER_HISTORY_DRIFT");
    expect(migration).not.toMatch(/alter table app_data_agent\.falcon24_qualifications/iu);
    expect(migration).not.toMatch(/alter table app_data_agent\.falcon24_acceptance_campaigns/iu);
    expect(migration).not.toMatch(
      /update app_data_agent\.falcon24_(qualifications|acceptance_campaigns)/iu,
    );
    expect(migration).not.toMatch(/delete from app_data_agent\.falcon24_/iu);
  });

  it("binds the exact 15-turn bank and 5/2/2/6 order server-side", () => {
    expect(migration).toContain("falcon24-four-layer-gate-manifest@1.0.0");
    expect(migration).toContain(
      "sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9",
    );
    expect(migration).toContain("pg_catalog.jsonb_array_length(manifest->'turns')<>15");
    expect(migration).toContain("array[5,2,2,6]::integer[]");
    expect(migration).toContain("L4-A");
    expect(migration).toContain("L4-B");
  });

  it("installs the complete expected-version RPC sequence", () => {
    for (const functionName of [
      "load_falcon24_four_layer_gate_attempt",
      "load_falcon24_four_layer_gate_turn",
      "begin_falcon24_four_layer_gate",
      "claim_falcon24_four_layer_gate_turn",
      "record_falcon24_four_layer_business_receipt",
      "record_falcon24_four_layer_qa_ui_receipt",
      "record_falcon24_four_layer_trace_ui_receipt",
      "finalize_falcon24_four_layer_gate_turn",
      "finalize_falcon24_four_layer_gate_attempt",
    ]) {
      expect(migration).toContain(`function app_data_agent.${functionName}`);
    }
    expect(migration).toContain("expected_attempt_version");
    expect(migration).toContain("expected_turn_version");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("for update");
  });

  it("fails closed across business, QA, Trace, build, attempt, Run, and conversation stages", () => {
    expect(migration).toContain("FALCON24_FOUR_LAYER_BUILD_MISMATCH");
    expect(migration).toContain("FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH");
    expect(migration).toContain("FALCON24_FOUR_LAYER_UI_AFTER_BUSINESS_FAILURE");
    expect(migration).toContain("FALCON24_FOUR_LAYER_TRACE_BEFORE_QA_PASS");
    expect(migration).toContain("FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH");
    expect(migration).toContain("conversation_resource_version");
    expect(migration).toContain("claim_command_hash");
  });

  it("forces RLS, server-owned mutation, replay fences, and rollback-safe install", () => {
    expect(migration.match(/force row level security/gu)).toHaveLength(2);
    expect(migration).toContain("falcon24_four_layer_attempt_state_fence");
    expect(migration).toContain("falcon24_four_layer_turn_state_fence");
    expect(migration).toContain("to data_agent_u6_rpc_owner");
    expect(migration).toContain("to data_agent_backend");
    expect(migration).toContain("FALCON24_FOUR_LAYER_REPLAY_MISMATCH");
    expect(migration).toContain("FALCON24_FOUR_LAYER_VERSION_CONFLICT");
    expect(migration).toContain("FALCON24_FOUR_LAYER_GATE_POSTCONDITION_FAILED");
  });
});
