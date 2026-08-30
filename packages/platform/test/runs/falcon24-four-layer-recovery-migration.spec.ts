import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const path = resolve(root, "infra/supabase/apps/data-agent/migrations/20260725010814_app_data_agent_falcon24_four_layer_recovery.sql");
const sql = existsSync(path) ? readFileSync(path, "utf8") : "";

describe("10814 four-layer recovery installation contract (not PostgreSQL acceptance)", () => {
  it("is checksum-bound to the exact predecessor and preserves old source bytes", () => {
    const checksum = /^-- falcon24_four_layer_recovery_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(sql)?.[1] ?? "";
    expect(checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(sql.split(checksum)).toHaveLength(3);
    expect(createHash("sha256").update(sql.replaceAll(checksum, "0".repeat(64))).digest("hex")).toBe(checksum);
    expect(sql).toContain("20260725010813_app_data_agent_agent_team_trace_run_read");
    expect(sql).toContain("sha256:392a59f42b7340d30c610fffa2f9d7df94eaa0e7aa8a4a71ae0541fb0723966e");
    expect(sql).toContain("b2531eea1d27e13ae279bd9842316775eaa5cd00ac630382c30605fde4e62282");
  });

  it("uses the existing RPC and fences legacy protocol bypass for E12+", () => {
    expect(sql).toContain("rename to activate_falcon24_authority_pre_e12");
    expect(sql).toContain("FALCON24_FOUR_LAYER_RECOVERY_PROTOCOL_REQUIRED");
    expect(sql).toContain("falcon24-activation-request@8.0.0");
    expect(sql).toContain("activate_falcon24_authority_pre_e10(v3_command)");
    expect(sql).not.toContain("create function app_data_agent.activate_falcon24_four_layer");
  });

  it("checks actual first failed turn and predecessor frozen build without Diagnostic synthesis", () => {
    for (const expected of [
      "failed_attempt.status is distinct from 'FAILED'", "failed_turn.status is distinct from 'FAILED'",
      "failed_attempt.first_failure_turn_ordinal", "failed_attempt.first_failure_run_id",
      "failed_attempt.source_commit is distinct from predecessor_baseline.source_commit",
      "failed_attempt.web_build_hash is distinct from predecessor_baseline.web_build_hash",
      "falcon24_four_layer_receipt_identity_matches", "failed_turn.terminal_receipt_hash",
      "failed_stage_code is distinct from failure_ref->>'failure_code'",
    ]) expect(sql).toContain(expected);
    expect(sql).not.toMatch(/(?:insert into|update|delete from) app_data_agent\.falcon24_(?:four_layer_gate|diagnostic)/iu);
  });

  it("rejects null/missing request identity and persists exact command/result replay", () => {
    expect(sql).toContain("command->>'schema_version' is distinct from 'falcon24-activation-request@8.0.0'");
    expect(sql).toContain("pg_catalog.jsonb_typeof(failure_ref->'turn_ordinal') is distinct from 'number'");
    expect(sql).toContain("existing_recovery.command_document is distinct from command");
    expect(sql).toContain("FALCON24_FOUR_LAYER_RECOVERY_REPLAY_CONFLICT");
    expect(sql).toContain("falcon24_retained_recovery_activation_receipts");
    expect(sql).toContain("before update or delete");
    expect(sql).toContain("force row level security");
  });

  it("preserves the lock/promotion/activation/receipt sequence", () => {
    const sequence = [
      "perform semantic.lock_semantic_authority_fence", "from app_data_agent.falcon24_current_authority_epoch current_source",
      "from app_data_agent.falcon24_four_layer_gate_attempts failure_source",
      "from app_data_agent.falcon24_llm_execution_certification_stage stage_source",
      "status='PROMOTED',activation_attempt_id", "activate_falcon24_authority_pre_e10(v3_command)",
      "insert into app_data_agent.falcon24_retained_recovery_activation_receipts",
    ];
    let cursor = -1;
    for (const marker of sequence) {
      const next = sql.indexOf(marker, cursor + 1);
      expect(next, marker).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(sql).toContain("FALCON24_FOUR_LAYER_RECOVERY_HISTORY_DRIFT");
    expect(sql).toContain("FALCON24_FOUR_LAYER_RECOVERY_SECURITY_DRIFT");
  });
});
