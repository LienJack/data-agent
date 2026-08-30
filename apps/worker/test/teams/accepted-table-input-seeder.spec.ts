import {
  artifactReferenceIdentity,
  DEFAULT_RUN_EXECUTION_POLICY,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  buildAcceptedTableInputSeedConfig,
  createAcceptedTableInputSeeder,
} from "../../src/teams/accepted-table-input-seeder.js";

const id = (suffix: number) => `81000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("accepted table input seeder", () => {
  it("commits one exact-Run accepted input before exposing only its safe projection to Root", async () => {
    const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
    const lease = {
      scope,
      principal_id: id(3),
      outbox_id: id(4),
      run_id: id(5),
      command_id: id(6),
      command_kind: "START_DATA_AGENT_TEAM" as const,
      attempt_id: id(7),
      attempt_no: 1,
      delivery_attempt_no: 1,
      lease_duration_ms: 30_000,
      worker_id: "worker-accepted-input",
      lease_token: 1,
      worker_fence: 1,
      expires_at: "2026-08-30T04:05:00.000Z",
      execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      payload: {} as never,
    };
    const config = await buildAcceptedTableInputSeedConfig({
      schema_version: "accepted-table-input-seed@1.0.0",
      scope: { ...scope, principal_id: lease.principal_id },
      run_id: lease.run_id,
      acceptance_id: id(8),
      accepted_at: "2026-08-30T04:00:00.000Z",
      title: "已确认渠道经营表",
      table: {
        kind: "TABLE",
        columns: [
          { key: "channel", label: "渠道", data_type: "STRING" },
          { key: "revenue", label: "营销收入", data_type: "NUMBER" },
        ],
        rows: [
          { channel: "邮件", revenue: 160_000 },
          { channel: "搜索广告", revenue: 360_000 },
        ],
        total_rows: 2,
      },
    });
    const committed: unknown[] = [];
    const emitDisplayEvent = vi.fn(async () => ({
      ok: true as const,
      value: { sequence: 4 },
    }));
    const seeder = createAcceptedTableInputSeeder(
      {
        capability: { kind: "test" },
        artifacts: {
          async commit(_capability, _lease, document) {
            committed.push(document);
            const verified = await verifyProductTeamArtifactDocument(document);
            return { ok: true as const, value: verified.artifact_ref };
          },
        },
      },
      config,
    );

    const result = await seeder.load({
      lease,
      restored_snapshot: null,
      context: { emitDisplayEvent } as never,
      signal: new AbortController().signal,
      deadline_at: lease.expires_at,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value).toHaveLength(1);
    const accepted = result.value[0];
    if (!accepted) throw new Error("accepted input missing");
    expect(accepted).toMatchObject({
      schema_version: "root-accepted-input-artifact@1.0.0",
      artifact_ref: { artifact_type: "QueryEvidence", run_id: lease.run_id },
      safe_projection: {
        projection_kind: "TABLE",
        column_keys: ["channel", "revenue"],
        total_rows: 2,
      },
    });
    expect(accepted).not.toHaveProperty("safe_projection.rows");
    const document = await verifyProductTeamArtifactDocument(committed[0]);
    expect(document).toMatchObject({
      profile_id: "data-agent-orchestrator",
      source_refs: [],
      provenance: {
        kind: "ACCEPTED_TABLE_INPUT",
        acceptance_id: config.acceptance_id,
        row_count: 2,
      },
      projection: config.table,
    });
    expect(artifactReferenceIdentity(document.artifact_ref)).toBe(
      artifactReferenceIdentity(accepted.artifact_ref),
    );
    expect(emitDisplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool_started",
        tool_name: "accepted_input.attach",
        profile_id: null,
        task_id: null,
        artifact_refs: [],
      }),
    );
    expect(emitDisplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool_completed",
        tool_name: "accepted_input.attach",
        profile_id: null,
        task_id: null,
        artifact_refs: [document.artifact_ref],
      }),
    );
  });
});
