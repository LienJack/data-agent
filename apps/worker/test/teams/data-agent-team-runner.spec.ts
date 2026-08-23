import { buildSubagentCapabilityCatalogSnapshot, type RunWorkLease } from "@data-agent/contracts";
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
  return { context, lease };
}

describe("Data Agent direct runner", () => {
  it("routes every valid QUESTION_RUN lease directly without Root or Specialist", async () => {
    const { context, lease } = await harness();
    const execute = vi.fn(async () => ({ kind: "COMPLETED" as const }));
    const runner = createDataAgentTeamRunner({ direct_analysis: { execute } });

    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("fails closed when the direct executor is not configured", async () => {
    const { context, lease } = await harness();
    const runner = createDataAgentTeamRunner({});
    await expect(
      runner.execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "DIRECT_QA_EXECUTOR_NOT_CONFIGURED" });
  });

  it("rejects a non-Q&A command before invoking direct analysis", async () => {
    const { context, lease } = await harness();
    const execute = vi.fn();
    const runner = createDataAgentTeamRunner({ direct_analysis: { execute } });
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
});
