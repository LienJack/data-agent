import {
  type AppScope,
  DEFAULT_RUN_EXECUTION_POLICY,
  type PortResult,
  type RunWorkLease,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createResearchWorkflowExecutor } from "../../src/runs/research-workflow-executor.js";
import {
  createRunExecutionContext,
  type RunBoundProviderDispatcher,
} from "../../src/runs/run-execution-context.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "./support/effective-config-fixture.js";

const scope = {
  app_id: "86000000-0000-4000-8000-000000000001",
  tenant_id: "86000000-0000-4000-8000-000000000002",
  environment: "test",
} as const satisfies AppScope;
const principalId = "86000000-0000-4000-8000-000000000003";

function lease(): RunWorkLease {
  return {
    scope,
    principal_id: principalId,
    outbox_id: "86000000-0000-4000-8000-000000000004",
    run_id: "86000000-0000-4000-8000-000000000005",
    command_id: "86000000-0000-4000-8000-000000000006",
    command_kind: "START_L2_RESEARCH",
    attempt_id: "86000000-0000-4000-8000-000000000007",
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-u3",
    lease_token: 2,
    worker_fence: 3,
    expires_at: "2026-08-16T10:05:00.000Z",
    execution_policy: DEFAULT_RUN_EXECUTION_POLICY,
    payload: { kind: "START_L2_RESEARCH" },
  };
}

describe("Research Worker governed Provider binding", () => {
  it("invokes only the run-bound opaque capability and stops before research on audited failure", async () => {
    const config = await buildWorkerEffectiveConfigFixture({
      scope,
      workspace_id: scope.tenant_id,
      principal_id: principalId,
      run_id: lease().run_id,
    });
    const workerLease = bindEffectiveConfigLease(lease(), config);
    const loaded = await createEffectiveConfigFixtureLoader(config)(workerLease);
    if (!loaded.ok) throw new Error("effective config fixture failed");
    const consumption = loaded.value as {
      readonly context_receipt: Parameters<typeof createRunExecutionContext>[0]["context_receipt"];
    };
    const dispatch = {
      invoke: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
          message: "unknown",
          retryable: false,
        },
      })),
    } satisfies RunBoundProviderDispatcher;
    const displayEvents: unknown[] = [];
    const semanticContext = {
      resolve: vi.fn(async () => ({
        ok: true as const,
        value: {
          receipt: {
            state: "READY",
            route: "METRIC",
            package_ref: {
              package_id: "86000000-0000-4000-8000-000000000010",
              package_hash: `sha256:${"a".repeat(64)}`,
            },
          },
        } as never,
      })),
    };
    const context = createRunExecutionContext({
      lease: workerLease,
      effective_config: config,
      context_receipt: consumption.context_receipt,
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-16T10:01:00.000Z"),
      create_id: () => "86000000-0000-4000-8000-000000000099",
      side_effect_timeout_ms: 1_000,
      provider_dispatch: dispatch,
      semantic_context: semanticContext,
      heartbeat: async () => ({ ok: true, value: { expires_at: workerLease.expires_at } }),
      guard_running_lease: async () =>
        ({
          ok: false,
          error: { code: "UNUSED", message: "unused", retryable: false },
        }) satisfies PortResult<never>,
      append_checkpoint_event: async () => ({ ok: true, value: {} }),
      append_side_effect_event: async () => ({ ok: true, value: {} as never }),
      append_display_event: async (event) => {
        displayEvents.push(event);
        return { ok: true, value: { sequence: displayEvents.length } };
      },
    });
    const executor = createResearchWorkflowExecutor({
      research_authority: {} as never,
      authority_capabilities: {
        forArtifactType: () => ({
          app_capability: {},
          authority_capability_id: "86000000-0000-4000-8000-000000000008",
        }),
        forDomain: () => ({
          app_capability: {},
          authority_capability_id: "86000000-0000-4000-8000-000000000008",
        }),
      },
      principal_id: principalId,
      create_id: () => "86000000-0000-4000-8000-000000000009",
      now: () => new Date("2026-08-16T10:01:00.000Z"),
    });

    const result = await executor.execute({
      lease: workerLease,
      restored_snapshot: null,
      context,
      signal: new AbortController().signal,
      deadline_at: "2026-08-16T10:05:00.000Z",
    });

    expect(result).toEqual({
      kind: "FAILED",
      error_code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
    });
    expect(dispatch.invoke).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      lease: workerLease,
      effective_config: config,
      context_receipt: consumption.context_receipt,
      logical_call_id: workerLease.command_id,
    });
    expect(semanticContext.resolve).toHaveBeenCalledTimes(1);
    expect(semanticContext.resolve.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.invoke.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    const semanticContextCapability = context.getSemanticContextCapability?.();
    expect(semanticContextCapability).not.toBeNull();
    if (!semanticContextCapability) throw new Error("semantic context capability missing");
    const repeatedResolutionOne = semanticContextCapability.resolve();
    const repeatedResolutionTwo = semanticContextCapability.resolve();
    expect(repeatedResolutionTwo).toBe(repeatedResolutionOne);
    await expect(repeatedResolutionOne).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        receipt: expect.objectContaining({ state: "READY", route: "METRIC" }),
      }),
    });
    expect(semanticContext.resolve).toHaveBeenCalledTimes(1);
    expect(displayEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "progress", phase: "provider.direct.prepare" }),
        expect.objectContaining({ kind: "tool_started", tool_name: "provider.dispatch" }),
        expect.objectContaining({
          kind: "tool_failed",
          error_code: "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
        }),
      ]),
    );
  });
});
