import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010806_app_data_agent_falcon24_four_layer_lock_repair.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_four_layer_lock_repair_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10806 Falcon24 four-layer lock and conversation read repair", () => {
  it("is rendered, checksummed, forward-only, and chained from exact 10805", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010805_app_data_agent_falcon24_fence_token_secret_guard");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("repairs all six attempt-lock mutations without rewriting prior migrations", () => {
    for (const functionName of [
      "claim_falcon24_four_layer_gate_turn",
      "record_falcon24_four_layer_business_receipt",
      "record_falcon24_four_layer_qa_ui_receipt",
      "record_falcon24_four_layer_trace_ui_receipt",
      "finalize_falcon24_four_layer_gate_turn",
      "finalize_falcon24_four_layer_gate_attempt",
    ]) {
      expect(migration).toContain(`app_data_agent.${functionName}(jsonb)`);
    }
    expect(migration).toContain(
      "'data-agent:falcon24-four-layer-attempt:'||(command->>'attempt_id')",
    );
    expect(migration).toContain(
      "'data-agent:falcon24-four-layer-attempt:'||(receipt->>'attempt_id')",
    );
    expect(migration).toContain("FALCON24_FOUR_LAYER_LOCK_REPAIR_SOURCE_MISMATCH");
    expect(migration).toContain("FALCON24_FOUR_LAYER_LOCK_REPAIR_POSTCONDITION_FAILED");
  });

  it("grants the gate owner only exact-principal read access to conversations", () => {
    expect(migration).toContain("create policy falcon24_four_layer_gate_conversation_select");
    expect(migration).toContain("on app_data_agent.qa_conversations for select");
    expect(migration).toContain("to data_agent_u6_rpc_owner");
    expect(migration.replace(/\s+/gu, "")).toContain(
      "platform.backend_exact_principal_object_matches(app_id,tenant_id,environment,owner_principal_id,true)",
    );
    expect(migration).not.toContain("for all to data_agent_u6_rpc_owner");
  });

  it("preserves protected history and performs no data repair", () => {
    expect(migration).toContain("falcon24_10806_history_snapshot");
    expect(migration).toContain("FALCON24_FOUR_LAYER_LOCK_REPAIR_HISTORY_DRIFT");
    expect(migration).not.toMatch(/delete from app_data_agent\./iu);
    expect(migration).not.toMatch(/update app_data_agent\./iu);
    expect(migration).not.toMatch(/insert into app_data_agent\./iu);
    expect(migration).not.toMatch(/alter table app_data_agent\./iu);
  });
});
