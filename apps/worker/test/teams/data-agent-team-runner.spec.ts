import {
  buildSubagentCapabilityCatalogSnapshot,
  DEFAULT_RUN_EXECUTION_POLICY,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import { createDataAgentTeamRunner } from "../../src/teams/data-agent-team-runner.js";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
  effectiveConfigRef,
} from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `80000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
async function harness() {
  const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
  const runId = id(3);
  const principalId = id(4);
  const effectiveConfig = await buildWorkerEffectiveConfigFixture({
    scope,
    workspace_id: scope.tenant_id,
    principal_id: principalId,
    run_id: runId,
  });
  const catalog = await buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: id(10),
    scope,
    run_id: runId,
    principal_id: principalId,
    policy_version: "root-harness@1.0.0",
    items: [],
  });
  const lease: RunWorkLease = {
    scope,
    principal_id: principalId,
    outbox_id: id(20),
    run_id: runId,
    command_id: id(21),
    command_kind: "START_DATA_AGENT_TEAM",
    attempt_id: id(22),
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-direct-qa",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-23T00:05:00.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: {
      schema_version: "effective-config-team-lease@3.0.0",
      kind: "START_DATA_AGENT_TEAM",
      executor_version: "ROOT_HARNESS@1",
      effective_config_ref: effectiveConfigRef(effectiveConfig),
      catalog_snapshot: catalog,
      visible_message_refs: [id(23)],
    },
  };
  const loaded = await createEffectiveConfigFixtureLoader(effectiveConfig)(lease);
  if (!loaded.ok) throw new Error("fixture load failed");
  const consumed = loaded.value as {
    readonly effective_config: Parameters<typeof createRunExecutionContext>[0]["effective_config"];
    readonly context_receipt: Parameters<typeof createRunExecutionContext>[0]["context_receipt"];
  };
  const context = createRunExecutionContext({
    lease,
    effective_config: consumed.effective_config,
    context_receipt: consumed.context_receipt,
    run_signal: new AbortController().signal,
    event_store: {
      findSideEffect: vi.fn(async () => ({ ok: true as const, value: null })),
      commitSideEffect: vi.fn(),
      commitSnapshot: vi.fn(),
    },
    now: () => new Date("2026-08-23T00:00:00.000Z"),
    create_id: () => id(30),
    side_effect_timeout_ms: 1_000,
    provider_dispatch: null,
    heartbeat: vi.fn(async () => ({ ok: true as const, value: { expires_at: lease.expires_at } })),
    guard_running_lease: vi.fn(),
    append_checkpoint_event: vi.fn(),
    append_side_effect_event: vi.fn(),
    append_display_event: vi.fn(),
  });
  const authorityBinding = {
    schema_version: "falcon24-authority-binding@2.0.0" as const,
    authority_epoch: "E2" as const,
    baseline_id: id(40),
    baseline_hash: `sha256:${"a".repeat(64)}` as const,
    activation_attempt_id: id(41),
  };
  const authority = {
    loadCurrent: vi.fn(async () => ({ ok: true as const, value: authorityBinding })),
    loadRunBinding: vi.fn(async () => ({ ok: true as const, value: authorityBinding })),
  };
  const catalogAuthority = {
    loadFrozen: vi.fn(async () => ({ ok: true as const, value: [] })),
  };
  return { authority, catalog, catalogAuthority, context, lease };
}

describe("Data Agent Root runner", () => {
  it("routes every V3 QUESTION_RUN through Root and its admitted runtime", async () => {
    const { authority, catalog, catalogAuthority, context, lease } = await harness();
    const decision = {
      schema_version: "root-agent-turn-candidate@1.0.0" as const,
      kind: "FINAL_ANSWER" as const,
      scope: lease.scope,
      run_id: lease.run_id,
      catalog_snapshot_hash: catalog.snapshot_hash,
      sections: [
        {
          kind: "GENERAL_TEXT" as const,
          text: "同比增长是相邻可比周期的相对变化。",
          basis: "GENERAL_KNOWLEDGE" as const,
          source_message_refs: [],
        },
      ],
      public_summary: "解释同比增长。",
    };
    const decide = vi.fn(async () => ({ ok: true as const, value: decision }));
    const execute = vi.fn(async () => ({
      status: "ACCEPTED" as const,
      reason_code: "ROOT_DIRECT_ANSWER_ACCEPTED",
    }));
    const runner = createDataAgentTeamRunner({
      authority,
      catalog_authority: catalogAuthority,
      root: { decide },
      root_runtime: { execute },
    });

    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(decide).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ decision }));
  });

  it("fails closed when Root is not configured", async () => {
    const { authority, catalogAuthority, context, lease } = await harness();
    const runner = createDataAgentTeamRunner({
      authority,
      catalog_authority: catalogAuthority,
    });
    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "ROOT_AGENT_TURN_NOT_CONFIGURED" });
  });

  it("rejects a non-Q&A command before invoking Root", async () => {
    const { authority, catalogAuthority, context, lease } = await harness();
    const execute = vi.fn();
    const runner = createDataAgentTeamRunner({
      authority,
      catalog_authority: catalogAuthority,
      root: { decide: execute },
    });
    await expect(
      runner.execute({
        lease: { ...lease, command_kind: "RESUME_RUN" },
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "DATA_AGENT_TEAM_LEASE_INVALID" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects old Team leases instead of entering a compatibility executor", async () => {
    const { authority, catalogAuthority, context, lease } = await harness();
    const decide = vi.fn();
    const legacyLease = {
      ...lease,
      payload: {
        kind: "START_DATA_AGENT_TEAM" as const,
        effective_config_ref: lease.payload.effective_config_ref,
        profile_refs: [
          "governed-text2sql-agent",
          "report-writing-agent",
          "semantic-management-agent",
        ].map((profileId, index) => ({
          profile_id: profileId,
          revision: 1,
          revision_hash: `sha256:${String(index + 1).repeat(64)}`,
        })),
      },
    } as RunWorkLease;
    const runner = createDataAgentTeamRunner({
      authority,
      catalog_authority: catalogAuthority,
      root: { decide },
    });

    await expect(
      runner.execute({
        lease: legacyLease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: legacyLease.expires_at,
      }),
    ).resolves.toEqual({
      kind: "FAILED",
      error_code: "ROOT_AGENT_LEASE_VERSION_UNSUPPORTED",
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects a historical E1 Run when the current authority is E2", async () => {
    const { authority, catalogAuthority, context, lease } = await harness();
    const decide = vi.fn();
    authority.loadRunBinding.mockResolvedValueOnce({
      ok: true as const,
      value: {
        schema_version: "falcon24-authority-binding@1.0.0" as const,
        authority_epoch: "E1" as const,
        baseline_id: id(42),
        baseline_hash: `sha256:${"b".repeat(64)}` as const,
        activation_attempt_id: id(43),
      },
    } as never);
    const runner = createDataAgentTeamRunner({
      authority,
      catalog_authority: catalogAuthority,
      root: { decide },
    });

    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      }),
    ).resolves.toEqual({
      kind: "FAILED",
      error_code: "FALCON24_RUNTIME_AUTHORITY_DRIFT",
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects frozen Profile/Card drift before invoking Root provider", async () => {
    const { authority, catalogAuthority, context, lease } = await harness();
    const decide = vi.fn();
    catalogAuthority.loadFrozen.mockResolvedValueOnce({
      ok: false as const,
      error: {
        code: "SUBAGENT_PROFILE_CATALOG_BINDING_STALE",
        message: "stale",
        retryable: false,
      },
    } as never);
    const runner = createDataAgentTeamRunner({
      authority,
      catalog_authority: catalogAuthority,
      root: { decide },
    });

    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      }),
    ).resolves.toEqual({
      kind: "FAILED",
      error_code: "SUBAGENT_PROFILE_CATALOG_BINDING_STALE",
    });
    expect(decide).not.toHaveBeenCalled();
  });
});
