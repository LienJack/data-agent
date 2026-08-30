import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010811_app_data_agent_falcon24_root_agent_public_event.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_root_agent_public_event_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10811 Falcon24 Root Agent public lifecycle event", () => {
  it("is checksummed and chained from exact 10810", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010810_app_data_agent_falcon24_ready_attempt_supersession",
    );
    expect(migration).toContain(
      "sha256:2204b6f357a3ef32c84e57700944c5929cce7fa16f3327d7dee36dc19813fb3a",
    );
  });

  it("admits the Root Agent only for run.agent_status", () => {
    expect(migration).toContain("data-agent-orchestrator");
    expect(migration).toContain("'run.agent_status'");
    expect(migration).toContain("FALCON24_ROOT_AGENT_PUBLIC_STATUS_REJECTED");
    expect(migration).toContain("FALCON24_ROOT_AGENT_PUBLIC_TOOL_PERMISSION_WIDENED");
    expect(migration).toContain("FALCON24_MODEL_REQUEST_PUBLIC_EVENT_REJECTED");
    expect(migration).toContain("public_run_v2_payload_is_valid(");
    expect(migration).toContain("'run.tool_started'");
  });

  it("rewrites one exact status clause and preserves function ownership and grants", () => {
    expect(migration).toContain("source_status_clause");
    expect(migration).toContain("target_status_clause");
    expect(migration).toContain("FALCON24_ROOT_AGENT_PUBLIC_EVENT_SOURCE_MISMATCH");
    expect(migration).toContain("FALCON24_ROOT_AGENT_PUBLIC_EVENT_REWRITE_FAILED");
    expect(migration).toContain("owner to postgres");
    expect(migration).toContain("revoke all on function");
    expect(migration).not.toContain(
      "('data-agent-orchestrator','governed-analysis-agent','governed-text2sql-agent','report-writing-agent','semantic-management-agent')\n    or",
    );
  });
});
