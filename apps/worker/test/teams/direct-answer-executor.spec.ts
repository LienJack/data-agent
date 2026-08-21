import {
  buildAgentDispatchExecutionBinding,
  buildAgentDispatchPlan,
  buildDirectAdmissibilityReceipt,
  type RunWorkLease,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutionContext } from "../../src/runs/run-execution-context.js";
import { createDirectAnswerExecutor } from "../../src/teams/direct-answer-executor.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
  effectiveConfigRef,
} from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `92000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

describe("DIRECT answer executor", () => {
  it("uses the frozen Provider authority and emits only root public answer events", async () => {
    const baseLease: RunWorkLease = {
      scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
      principal_id: id(3),
      outbox_id: id(4),
      run_id: id(5),
      command_id: id(6),
      command_kind: "START_L2_RESEARCH",
      attempt_id: id(7),
      attempt_no: 1,
      delivery_attempt_no: 1,
      lease_duration_ms: 30_000,
      worker_id: "worker-direct",
      lease_token: 1,
      worker_fence: 1,
      expires_at: "2026-08-22T01:00:30.000Z",
      payload: { kind: "START_L2_RESEARCH" },
    };
    const config = await buildWorkerEffectiveConfigFixture({
      scope: baseLease.scope,
      workspace_id: baseLease.scope.tenant_id,
      principal_id: baseLease.principal_id,
      run_id: baseLease.run_id,
    });
    const capabilityHash = await sha256ContentHash({ direct: true });
    const directReceipt = await buildDirectAdmissibilityReceipt({
      schema_version: "direct-admissibility-receipt@1.0.0",
      no_new_facts: true,
      no_governance_mutation: true,
      no_formal_report: true,
      policy_version: "adaptive-routing@1.0.0",
      capability_snapshot_hash: capabilityHash,
    });
    const plan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: id(8),
      run_id: baseLease.run_id,
      question_class: "EXPLANATION",
      mode: "DIRECT",
      selected_profile_refs: [],
      dependency_edges: [],
      required_evidence: ["DIRECT_PROVIDER_RECEIPT"],
      reason_codes: ["DIRECT_EXPLANATION_ADMISSIBLE"],
      capability_snapshot_hash: capabilityHash,
      policy_version: "adaptive-routing@1.0.0",
      direct_admissibility_receipt: directReceipt,
    });
    const binding = await buildAgentDispatchExecutionBinding({
      schema_version: "agent-dispatch-execution-binding@1.0.0",
      run_id: baseLease.run_id,
      effective_executor_version: "ADAPTIVE@1",
      dispatch_plan_ref: { plan_id: plan.plan_id, plan_hash: plan.plan_hash },
      selected_profile_refs: [],
      policy_version: plan.policy_version,
      capability_snapshot_hash: plan.capability_snapshot_hash,
      shadow_dispatch_plan_ref: null,
    });
    const lease: RunWorkLease = {
      ...bindEffectiveConfigLease(baseLease, config),
      command_kind: "START_DATA_AGENT_TEAM",
      payload: {
        schema_version: "effective-config-team-lease@2.0.0",
        kind: "START_DATA_AGENT_TEAM",
        executor_version: "ADAPTIVE@1",
        effective_config_ref: effectiveConfigRef(config),
        profile_refs: [],
        dispatch_plan: plan,
        dispatch_binding: binding,
      },
    };
    const consumed = await createEffectiveConfigFixtureLoader(config)(lease);
    if (!consumed.ok) throw new TypeError("effective config fixture load failed");
    const contextReceipt = (
      consumed.value as {
        context_receipt: Parameters<typeof createRunExecutionContext>[0]["context_receipt"];
      }
    ).context_receipt;
    const displayEvents: unknown[] = [];
    const dispatch = vi.fn(async () => ({
      ok: true as const,
      value: {
        output_text: JSON.stringify({ answer: "同比用于比较本期与上年同期。" }),
        tool_calls: [],
        projection: { status: "COMPLETED" as const },
      },
    }));
    const context = createRunExecutionContext({
      lease,
      effective_config: config,
      context_receipt: contextReceipt,
      run_signal: new AbortController().signal,
      event_store: {} as never,
      now: () => new Date("2026-08-22T01:00:00.000Z"),
      create_id: () => id(9),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: { invoke: dispatch as never },
      heartbeat: vi.fn(),
      guard_running_lease: vi.fn(),
      append_checkpoint_event: vi.fn(),
      append_side_effect_event: vi.fn(),
      append_display_event: async (event) => {
        displayEvents.push(event);
        return { ok: true as const, value: { sequence: displayEvents.length } };
      },
    });

    await expect(
      createDirectAnswerExecutor().execute({
        lease,
        restored_snapshot: null,
        context,
        signal: new AbortController().signal,
        deadline_at: "2026-08-22T01:01:00.000Z",
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(displayEvents).toEqual([
      expect.objectContaining({ kind: "reasoning_started" }),
      expect.objectContaining({ kind: "reasoning_completed" }),
      expect.objectContaining({ kind: "answer_delta", delta: "同比用于比较本期与上年同期。" }),
    ]);
  });
});
