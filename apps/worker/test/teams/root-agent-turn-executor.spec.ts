import { buildSubagentCapabilityCatalogSnapshot, type RunWorkLease } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import { createRootAgentTurnExecutor } from "../../src/teams/root-agent-turn-executor.js";
import {
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
  effectiveConfigRef,
} from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `81000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("Root Agent direct-answer review", () => {
  it("uses review only as a routing decision and preserves the original direct answer", async () => {
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
    const reviewMeta = JSON.stringify({
      kind: "FINAL_ANSWER",
      sections: [
        {
          kind: "GENERAL_TEXT",
          text: "审查结论：这个问题可以直接回答。",
          basis: "GENERAL_KNOWLEDGE",
          source_message_refs: [],
        },
      ],
      public_summary: "审查通过。",
    });
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { output_text: direct, tool_calls: [], projection: {} },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { output_text: reviewMeta, tool_calls: [], projection: {} },
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

    const result = await createRootAgentTurnExecutor().decide({
      lease,
      restored_snapshot: null,
      context,
      signal: new AbortController().signal,
      deadline_at: lease.expires_at,
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: "FINAL_ANSWER",
        sections: [expect.objectContaining({ text: "同比增长是本期与上年同期之间的相对变化。" })],
        public_summary: "解释同比增长。",
      }),
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0]).toMatchObject({
      turn: { phase: "DIRECT_ANSWER_REVIEW", prior_output_text: direct },
    });

    invoke.mockReset();
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { output_text: direct, tool_calls: [], projection: {} },
    });
    const strictContext = createRunExecutionContext({
      lease,
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
    const strictResult = await createRootAgentTurnExecutor({ max_turns: 1 }).decide({
      lease,
      restored_snapshot: null,
      context: strictContext,
      signal: new AbortController().signal,
      deadline_at: lease.expires_at,
    });
    expect(strictResult.ok).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ turn: { phase: "INITIAL" } });
  });
});
