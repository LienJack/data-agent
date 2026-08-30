import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const sql = readFileSync(
  resolve(
    root,
    "infra/supabase/apps/data-agent/migrations/20260725010815_app_data_agent_falcon24_recovery_certification_lock.sql",
  ),
  "utf8",
);

describe("10815 active certification lock visibility (not PostgreSQL acceptance)", () => {
  it("binds the immutable 10814 frontier and preserves activation source", () => {
    const hash =
      /^-- falcon24_recovery_certification_lock_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
        sql,
      )?.[1] ?? "";
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(sql.split(hash)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(sql.replaceAll(hash, "0".repeat(64)))
        .digest("hex"),
    ).toBe(hash);
    expect(sql).toContain(
      "sha256:eb85edc9df631ab973357bfa242ed556e81aad63613503dd6cf9640823fdf520",
    );
    expect(sql).toContain("ade70237e02f49478714ea3e5a2abb78efabcd1185ee936affd80502aa941384");
    expect(sql).not.toMatch(/create (?:or replace )?function/iu);
  });

  it("permits only the exact current recovery certification row to be locked", () => {
    expect(sql).toContain("on app_data_agent.artifacts for update to data_agent_u6_rpc_owner");
    for (const marker of [
      "artifact_type='ModelCertificationReceipt' and is_active",
      "stage.certification_run_id=artifacts.run_id",
      "stage.certification_artifact_id=artifacts.artifact_id",
      "stage.certification_revision=artifacts.revision",
      "stage.certification_content_hash=artifacts.content_hash",
      "stage.principal_id=(select principal_id from platform.current_backend_authority(true))",
      "current_epoch.activation_attempt_id=stage.activation_attempt_id",
      "stage.status='PROMOTED'",
      "recovery.activation_attempt_id=current_epoch.activation_attempt_id",
      "recovery.command_document#>>'{llm_execution_stage_ref,proof_hash}'=stage.proof_hash",
    ])
      expect(sql).toContain(marker);
  });

  it("adds neither grants nor mutation permission and guards existing policy/history bytes", () => {
    expect(sql).toContain("with check(false)");
    expect(sql).not.toMatch(
      /^\s*(?:grant|revoke|alter policy|drop policy|update |delete from |truncate )/imu,
    );
    expect(sql).toContain("FALCON24_RECOVERY_CERTIFICATION_LOCK_HISTORY_DRIFT");
    expect(sql).toContain("FALCON24_RECOVERY_CERTIFICATION_LOCK_SECURITY_DRIFT");
    expect(sql).toContain(
      "pg_get_functiondef('app_data_agent.reject_artifact_payload_mutation()'::regprocedure)",
    );
  });
});
