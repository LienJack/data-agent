import type { RunWorkLease } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createProviderSmokeExecutor } from "../../src/providers/provider-smoke-executor.js";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "../runs/support/effective-config-fixture.js";

function createRunWorkLeaseFixture(): RunWorkLease {
  return {
    scope: {
      app_id: "92000000-0000-4000-8000-000000000001",
      tenant_id: "92000000-0000-4000-8000-000000000002",
      environment: "test",
    },
    principal_id: "92000000-0000-4000-8000-000000000003",
    outbox_id: "92000000-0000-4000-8000-000000000004",
    run_id: "92000000-0000-4000-8000-000000000005",
    command_id: "92000000-0000-4000-8000-000000000006",
    command_kind: "START_L2_RESEARCH",
    attempt_id: "92000000-0000-4000-8000-000000000007",
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-u3-smoke",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-17T00:00:30.000Z",
    payload: { kind: "START_L2_RESEARCH" },
  };
}

describe("Provider smoke executor", () => {
  it("uses only the opaque run-bound dispatch and never returns protected output", async () => {
    const baseLease = createRunWorkLeaseFixture();
    const config = await buildWorkerEffectiveConfigFixture({
      scope: baseLease.scope,
      workspace_id: baseLease.scope.tenant_id,
      principal_id: baseLease.principal_id,
      run_id: baseLease.run_id,
    });
    const lease = bindEffectiveConfigLease(baseLease, config);
    const consumed = await createEffectiveConfigFixtureLoader(config)(lease);
    if (!consumed.ok) throw new Error("fixture load failed");
    const contextReceipt = (
      consumed.value as {
        readonly context_receipt: Parameters<
          typeof createRunExecutionContext
        >[0]["context_receipt"];
      }
    ).context_receipt;
    const dispatch = vi.fn(async () => ({
      ok: true as const,
      value: {
        output_text: "protected-response-must-not-escape",
        tool_calls: [],
        projection: { status: "COMPLETED" },
      },
    }));
    const context = createRunExecutionContext({
      lease,
      effective_config: config,
      context_receipt: contextReceipt,
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      create_id: () => lease.command_id,
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: dispatch as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(),
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(),
    });
    const executor = createProviderSmokeExecutor();

    const result = await executor.execute({
      lease,
      restored_snapshot: null,
      context,
      signal: new AbortController().signal,
      deadline_at: "2026-08-17T00:01:00.000Z",
    });

    expect(result).toEqual({ kind: "COMPLETED" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ logical_call_id: lease.command_id }),
    );
    expect(JSON.stringify(result)).not.toContain("protected-response-must-not-escape");
  });

  it("fails closed without trusted provider dispatch authority", async () => {
    const executor = createProviderSmokeExecutor();
    const result = await executor.execute({
      lease: { command_id: "92000000-0000-4000-8000-000000000001" } as never,
      restored_snapshot: null,
      context: {} as never,
      signal: new AbortController().signal,
      deadline_at: "2026-08-17T00:01:00.000Z",
    });
    expect(result).toEqual({ kind: "FAILED", error_code: "RUN_EXECUTION_CONTEXT_UNTRUSTED" });
  });
});
