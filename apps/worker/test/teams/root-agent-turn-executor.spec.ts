import {
  buildFalcon24RunExecutionPolicy,
  buildSubagentCapabilityCatalogSnapshot,
  DEFAULT_RUN_EXECUTION_POLICY,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import { createRootAgentTurnExecutor } from "../../src/teams/root-agent-turn-executor.js";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
  effectiveConfigRef,
} from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `81000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Root Agent normal turn", () => {
  it("invokes exactly one logical provider call per normal turn", async () => {
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
      catalog_id: id(5),
      scope,
      run_id: runId,
      principal_id: principalId,
      policy_version: "root-harness@1.0.0",
      items: [],
    });
    const lease: RunWorkLease = {
      scope,
      principal_id: principalId,
      outbox_id: id(6),
      run_id: runId,
      command_id: id(7),
      command_kind: "START_DATA_AGENT_TEAM",
      attempt_id: id(8),
      attempt_no: 1,
      delivery_attempt_no: 1,
      lease_duration_ms: 30_000,
      worker_id: "worker-root-review",
      lease_token: 1,
      worker_fence: 1,
      expires_at: "2026-08-25T10:05:00.000Z",
      execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
      payload: {
        schema_version: "effective-config-team-lease@3.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "ROOT_HARNESS@1",
        effective_config_ref: effectiveConfigRef(effectiveConfig),
        catalog_snapshot: catalog,
        visible_message_refs: [id(9)],
      },
    };
    const loaded = await createEffectiveConfigFixtureLoader(effectiveConfig)(lease);
    if (!loaded.ok) throw new Error("effective config fixture failed");
    const consumed = loaded.value as {
      readonly effective_config: Parameters<
        typeof createRunExecutionContext
      >[0]["effective_config"];
      readonly context_receipt: Parameters<typeof createRunExecutionContext>[0]["context_receipt"];
    };
    const direct = JSON.stringify({
      kind: "FINAL_ANSWER",
      sections: [
        {
          kind: "GENERAL_TEXT",
          text: "同比增长是本期与上年同期之间的相对变化。",
          basis: "GENERAL_KNOWLEDGE",
          source_message_refs: [],
        },
      ],
      public_summary: "解释同比增长。",
    });
    const invoke = vi.fn().mockResolvedValueOnce({
      ok: true,
      value: { output_text: direct, tool_calls: [], projection: {} },
    });
    const context = createRunExecutionContext({
      lease,
      effective_config: consumed.effective_config,
      context_receipt: consumed.context_receipt,
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-25T10:00:00.000Z"),
      create_id: () => id(10),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: invoke as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(),
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(async () => ({ ok: true as const, value: { sequence: 1 } })),
    });

    const result = await createRootAgentTurnExecutor().decide(
      {
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      },
      { turn_index: 0, tool_observations: [], verifier_feedback: null },
    );

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: "FINAL_ANSWER",
        sections: [expect.objectContaining({ text: "同比增长是本期与上年同期之间的相对变化。" })],
        public_summary: "解释同比增长。",
      }),
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      turn: {
        turn_index: 0,
        tool_observations: [],
        verifier_feedback: null,
      },
    });

    const duplicate = await createRootAgentTurnExecutor().decide(
      {
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      },
      { turn_index: 0, tool_observations: [], verifier_feedback: null },
    );
    expect(duplicate).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "PROVIDER_LOGICAL_CALL_DUPLICATE" }),
    });
    expect(invoke).toHaveBeenCalledOnce();

    const driftContext = createRunExecutionContext({
      lease,
      effective_config: consumed.effective_config,
      context_receipt: {
        ...consumed.context_receipt,
        schema_snapshot: {
          ...consumed.context_receipt.schema_snapshot,
          resource_hash: `sha256:${"f".repeat(64)}`,
        },
      },
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-25T10:00:00.000Z"),
      create_id: () => id(12),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: invoke as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(),
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(async () => ({ ok: true as const, value: { sequence: 1 } })),
    });
    const driftResult = await createRootAgentTurnExecutor().decide(
      {
        lease,
        restored_snapshot: null,
        context: driftContext,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      },
      { turn_index: 0, tool_observations: [], verifier_feedback: null },
    );
    expect(driftResult).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "ROOT_AGENT_CONTEXT_BINDING_INVALID" }),
    });
    expect(invoke).toHaveBeenCalledOnce();

    invoke.mockReset();
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { output_text: direct, tool_calls: [], projection: {} },
    });
    const strictLease: RunWorkLease = {
      ...lease,
      execution_policy: buildFalcon24RunExecutionPolicy({
        campaign_id: "E1-C1",
        case_id: "falcon24-business-review-18m",
        run_variant: "COLD",
        repetition: 1,
      }),
    };
    const strictContext = createRunExecutionContext({
      lease: strictLease,
      effective_config: consumed.effective_config,
      context_receipt: consumed.context_receipt,
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-25T10:00:00.000Z"),
      create_id: () => id(11),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: invoke as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(),
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(async () => ({ ok: true as const, value: { sequence: 1 } })),
    });
    const strictResult = await createRootAgentTurnExecutor().decide(
      {
        lease: strictLease,
        restored_snapshot: null,
        context: strictContext,
        signal: new AbortController().signal,
        deadline_at: strictLease.expires_at,
      },
      { turn_index: 0, tool_observations: [], verifier_feedback: null },
    );
    expect(strictResult.ok).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ turn: { turn_index: 0 } });
  });
});
