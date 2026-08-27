import {
  buildSubagentCapabilityCatalogSnapshot,
  DEFAULT_RUN_EXECUTION_POLICY,
  type MastraSnapshotBinding,
  type RootAgentDecisionCandidate,
  type RootToolObservation,
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

const id = (suffix: number) => `88000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function fixture() {
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
    worker_id: "worker-root-loop",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-27T10:05:00.000Z",
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
  if (!loaded.ok) throw new Error("fixture load failed");
  const consumed = loaded.value as {
    readonly effective_config: Parameters<typeof createRunExecutionContext>[0]["effective_config"];
    readonly context_receipt: Parameters<typeof createRunExecutionContext>[0]["context_receipt"];
  };
  const snapshots: MastraSnapshotBinding[] = [];
  const createContext = () =>
    createRunExecutionContext({
      lease,
      effective_config: consumed.effective_config,
      context_receipt: consumed.context_receipt,
      run_signal: new AbortController().signal,
      event_store: {
        findSideEffect: vi.fn(async () => ({ ok: true as const, value: null })),
        commitSideEffect: vi.fn(),
        commitSnapshot: vi.fn(
          async ({ binding }: { binding: Omit<MastraSnapshotBinding, "snapshot_hash"> }) => {
            const committed = { ...binding, snapshot_hash: hash("f") } as MastraSnapshotBinding;
            snapshots.push(committed);
            return { ok: true as const, value: { binding: committed } };
          },
        ),
      } as never,
      now: () => new Date("2026-08-27T10:00:00.000Z"),
      create_id: () => id(10 + snapshots.length),
      side_effect_timeout_ms: 1_000,
      provider_dispatch: null,
      heartbeat: vi.fn(async () => ({
        ok: true as const,
        value: { expires_at: lease.expires_at },
      })),
      guard_running_lease: vi.fn(async () => ({
        ok: true as const,
        value: { projection: { version: 10 }, projection_hash: hash("e") },
      })) as never,
      append_checkpoint_event: vi.fn(async () => ({ ok: true as const, value: null })),
      append_side_effect_event: vi.fn(),
      append_display_event: vi.fn(async () => ({ ok: true as const, value: { sequence: 11 } })),
    });
  const authorityBinding = {
    schema_version: "falcon24-authority-binding@2.0.0" as const,
    authority_epoch: "E2" as const,
    baseline_id: id(20),
    baseline_hash: hash("a"),
    activation_attempt_id: id(21),
  };
  const dependencies = {
    authority: {
      loadCurrent: vi.fn(async () => ({ ok: true as const, value: authorityBinding })),
      loadRunBinding: vi.fn(async () => ({ ok: true as const, value: authorityBinding })),
    },
    catalog_authority: {
      loadFrozen: vi.fn(async () => ({ ok: true as const, value: [] })),
    },
  };
  return { catalog, createContext, dependencies, lease, snapshots };
}

function finalDecision(
  input: Awaited<ReturnType<typeof fixture>>,
): Extract<RootAgentDecisionCandidate, { kind: "FINAL_ANSWER" }> {
  return {
    schema_version: "root-agent-turn-candidate@1.0.0",
    kind: "FINAL_ANSWER",
    scope: input.lease.scope,
    run_id: input.lease.run_id,
    catalog_snapshot_hash: input.catalog.snapshot_hash,
    sections: [
      {
        kind: "GENERAL_TEXT",
        text: "已完成回答。",
        basis: "GENERAL_KNOWLEDGE",
        source_message_refs: [],
      },
    ],
    public_summary: "完成回答。",
  };
}

function toolDecision(
  input: Awaited<ReturnType<typeof fixture>>,
): Extract<RootAgentDecisionCandidate, { kind: "TOOL_CALLS" }> {
  return {
    schema_version: "root-agent-turn-candidate@1.0.0",
    kind: "TOOL_CALLS",
    scope: input.lease.scope,
    run_id: input.lease.run_id,
    catalog_snapshot_hash: input.catalog.snapshot_hash,
    tool_calls: [
      {
        tool_name: "delegate_to_subagent@2",
        tool_call_id: "semantic-1",
        profile_id: "semantic-management-agent",
        objective: "Resolve governed semantics.",
        requested_artifact_types: ["AnalysisReport"],
        input_artifact_refs: [],
        requested_budget: {
          timeout_ms: 30_000,
          max_steps: 4,
          max_input_tokens: 10_000,
          max_output_tokens: 2_000,
          max_tool_calls: 1,
          max_context_bytes: 8_192,
        },
      },
    ],
    public_summary: "Resolve semantics.",
  };
}

function observation(input: Awaited<ReturnType<typeof fixture>>): RootToolObservation {
  const outputRef = {
    artifact_id: id(30),
    artifact_type: "AnalysisReport" as const,
    ...input.lease.scope,
    run_id: input.lease.run_id,
    revision: 1,
    content_hash: hash("b"),
  };
  return {
    schema_version: "root-tool-observation@1.0.0",
    tool_call_id: "semantic-1",
    profile_id: "semantic-management-agent",
    status: "COMPLETED",
    output_ref: outputRef,
    safe_projection: {
      schema_version: "root-tool-safe-projection@1.0.0",
      artifact_ref: outputRef,
      projection_kind: "REPORT",
      title: "语义结论",
      summary: "A governed semantic report is accepted.",
      column_keys: [],
      total_rows: null,
      source_artifact_refs: [],
      semantic_query_context: null,
    },
    error_code: null,
  };
}

describe("bounded Root tool loop", () => {
  it("returns accepted tool observations to the next Root turn", async () => {
    const input = await fixture();
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: toolDecision(input) })
      .mockResolvedValueOnce({ ok: true, value: finalDecision(input) });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        status: "CONTINUE",
        reason_code: "ROOT_TOOL_OBSERVATIONS_READY",
        observations: [observation(input)],
        verifier_feedback: null,
      })
      .mockResolvedValueOnce({ status: "ACCEPTED", reason_code: "ROOT_ANSWER_VERIFIED" });
    const runner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide },
      root_runtime: { execute },
    });

    await expect(
      runner.execute({
        lease: input.lease,
        restored_snapshot: null,
        context: input.createContext(),
        signal: new AbortController().signal,
        deadline_at: input.lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });

    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[0]?.[1]).toEqual({
      turn_index: 0,
      tool_observations: [],
      verifier_feedback: null,
    });
    const decideCalls = decide.mock.calls as unknown as Array<[unknown, unknown]>;
    expect(decideCalls[1]?.[1]).toMatchObject({
      turn_index: 1,
      tool_observations: [expect.objectContaining({ tool_call_id: "semantic-1" })],
      verifier_feedback: null,
    });
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      turn_index: 1,
      accepted_artifact_refs: [expect.objectContaining({ artifact_id: id(30) })],
    });
    expect(input.snapshots).toHaveLength(2);
    expect(input.snapshots.at(-1)?.mastra_snapshot).toMatchObject({ terminal: true });
  });

  it("feeds structured verifier rejection into a later normal turn", async () => {
    const input = await fixture();
    const decide = vi.fn(async () => ({ ok: true as const, value: finalDecision(input) }));
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        status: "CONTINUE",
        reason_code: "ROOT_ANSWER_EVIDENCE_REQUIRED",
        observations: [],
        verifier_feedback: {
          schema_version: "root-verifier-feedback@1.0.0",
          status: "REJECTED",
          reason_code: "ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED",
        },
      })
      .mockResolvedValueOnce({ status: "ACCEPTED", reason_code: "ROOT_ANSWER_VERIFIED" });
    const runner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide },
      root_runtime: { execute },
    });

    await runner.execute({
      lease: input.lease,
      restored_snapshot: null,
      context: input.createContext(),
      signal: new AbortController().signal,
      deadline_at: input.lease.expires_at,
    });

    const decideCalls = decide.mock.calls as unknown as Array<[unknown, unknown]>;
    expect(decideCalls[1]?.[1]).toMatchObject({
      turn_index: 1,
      verifier_feedback: { reason_code: "ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED" },
    });
  });

  it("supports serial Subagent calls across normal Root turns", async () => {
    const input = await fixture();
    const first = toolDecision(input);
    const firstObservation = observation(input);
    if (firstObservation.status !== "COMPLETED") throw new Error("completed fixture required");
    const firstCall = first.tool_calls[0];
    if (!firstCall) throw new Error("tool call fixture required");
    const second: RootAgentDecisionCandidate = {
      ...first,
      tool_calls: [
        {
          ...firstCall,
          tool_call_id: "text2sql-2",
          profile_id: "governed-text2sql-agent",
          requested_artifact_types: ["QueryEvidence"],
          input_artifact_refs: [firstObservation.output_ref],
        },
      ],
    };
    const secondOutputRef = {
      ...firstObservation.output_ref,
      artifact_id: id(31),
      artifact_type: "QueryEvidence" as const,
      content_hash: hash("c"),
    };
    const secondObservation: RootToolObservation = {
      schema_version: "root-tool-observation@1.0.0",
      tool_call_id: "text2sql-2",
      profile_id: "governed-text2sql-agent",
      status: "COMPLETED",
      output_ref: secondOutputRef,
      safe_projection: {
        schema_version: "root-tool-safe-projection@1.0.0",
        artifact_ref: secondOutputRef,
        projection_kind: "TABLE",
        title: null,
        summary: "12 accepted governed rows are available.",
        column_keys: ["month", "revenue"],
        total_rows: 12,
        source_artifact_refs: [],
        semantic_query_context: null,
      },
      error_code: null,
    };
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({ ok: true, value: second })
      .mockResolvedValueOnce({ ok: true, value: finalDecision(input) });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        status: "CONTINUE",
        reason_code: "ROOT_TOOL_OBSERVATIONS_READY",
        observations: [firstObservation],
        verifier_feedback: null,
      })
      .mockResolvedValueOnce({
        status: "CONTINUE",
        reason_code: "ROOT_TOOL_OBSERVATIONS_READY",
        observations: [secondObservation],
        verifier_feedback: null,
      })
      .mockResolvedValueOnce({ status: "ACCEPTED", reason_code: "ROOT_ANSWER_VERIFIED" });
    const runner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide },
      root_runtime: { execute },
    });

    await expect(
      runner.execute({
        lease: input.lease,
        restored_snapshot: null,
        context: input.createContext(),
        signal: new AbortController().signal,
        deadline_at: input.lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    const calls = decide.mock.calls as unknown as Array<
      [unknown, { tool_observations: unknown[] }]
    >;
    expect(calls[1]?.[1].tool_observations).toHaveLength(1);
    expect(calls[2]?.[1].tool_observations).toHaveLength(2);
  });

  it("returns a strict failed tool observation instead of unsafe error payload", async () => {
    const input = await fixture();
    const failedObservation: RootToolObservation = {
      schema_version: "root-tool-observation@1.0.0",
      tool_call_id: "semantic-1",
      profile_id: "semantic-management-agent",
      status: "FAILED",
      output_ref: null,
      safe_projection: null,
      error_code: "SEMANTIC_CONTEXT_AMBIGUOUS",
    };
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: toolDecision(input) })
      .mockResolvedValueOnce({ ok: true, value: finalDecision(input) });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        status: "CONTINUE",
        reason_code: "ROOT_TOOL_OBSERVATIONS_READY",
        observations: [failedObservation],
        verifier_feedback: null,
      })
      .mockResolvedValueOnce({ status: "ACCEPTED", reason_code: "ROOT_ANSWER_VERIFIED" });
    const runner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide },
      root_runtime: { execute },
    });

    await runner.execute({
      lease: input.lease,
      restored_snapshot: null,
      context: input.createContext(),
      signal: new AbortController().signal,
      deadline_at: input.lease.expires_at,
    });

    const calls = decide.mock.calls as unknown as Array<
      [unknown, { tool_observations: RootToolObservation[] }]
    >;
    expect(calls[1]?.[1].tool_observations).toEqual([failedObservation]);
    expect(JSON.stringify(calls[1]?.[1])).not.toContain("connection");
  });

  it("fails after four normal turns without retrying a provider call", async () => {
    const input = await fixture();
    const decide = vi.fn(async () => ({ ok: true as const, value: finalDecision(input) }));
    const execute = vi.fn(async () => ({
      status: "CONTINUE" as const,
      reason_code: "ROOT_ANSWER_EVIDENCE_REQUIRED",
      observations: [],
      verifier_feedback: {
        schema_version: "root-verifier-feedback@1.0.0" as const,
        status: "REJECTED" as const,
        reason_code: "ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED",
      },
    }));
    const runner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide },
      root_runtime: { execute },
    });

    await expect(
      runner.execute({
        lease: input.lease,
        restored_snapshot: null,
        context: input.createContext(),
        signal: new AbortController().signal,
        deadline_at: input.lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "ROOT_AGENT_TURN_BUDGET_EXHAUSTED" });
    expect(decide).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("rejects a later Root turn that reuses an observed tool call identity", async () => {
    const input = await fixture();
    const repeated = toolDecision(input);
    const decide = vi.fn(async () => ({ ok: true as const, value: repeated }));
    const execute = vi.fn(async () => ({
      status: "CONTINUE" as const,
      reason_code: "ROOT_TOOL_OBSERVATIONS_READY",
      observations: [observation(input)],
      verifier_feedback: null,
    }));
    const runner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide },
      root_runtime: { execute },
    });

    await expect(
      runner.execute({
        lease: input.lease,
        restored_snapshot: null,
        context: input.createContext(),
        signal: new AbortController().signal,
        deadline_at: input.lease.expires_at,
      }),
    ).resolves.toEqual({ kind: "FAILED", error_code: "ROOT_AGENT_TOOL_CALL_REPLAYED" });
    expect(decide).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("restores a completed checkpoint without repeating Root or Subagent effects", async () => {
    const input = await fixture();
    const decide = vi.fn(async () => ({ ok: true as const, value: finalDecision(input) }));
    const execute = vi.fn(async () => ({
      status: "ACCEPTED" as const,
      reason_code: "ROOT_ANSWER_VERIFIED",
    }));
    const runner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide },
      root_runtime: { execute },
    });
    const execution = {
      lease: input.lease,
      restored_snapshot: null,
      context: input.createContext(),
      signal: new AbortController().signal,
      deadline_at: input.lease.expires_at,
    };
    await expect(runner.execute(execution)).resolves.toEqual({ kind: "COMPLETED" });
    const terminal = input.snapshots.at(-1);
    if (!terminal) throw new Error("terminal checkpoint missing");

    decide.mockClear();
    execute.mockClear();
    await expect(
      runner.execute({ ...execution, restored_snapshot: terminal, context: input.createContext() }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    expect(decide).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("resumes after a tool checkpoint without repeating the completed tool turn", async () => {
    const input = await fixture();
    const firstDecide = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: toolDecision(input) })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "ROOT_PROVIDER_CRASH", message: "crash", retryable: false },
      });
    const firstExecute = vi.fn(async () => ({
      status: "CONTINUE" as const,
      reason_code: "ROOT_TOOL_OBSERVATIONS_READY",
      observations: [observation(input)],
      verifier_feedback: null,
    }));
    const firstRunner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide: firstDecide },
      root_runtime: { execute: firstExecute },
    });
    const execution = {
      lease: input.lease,
      restored_snapshot: null,
      context: input.createContext(),
      signal: new AbortController().signal,
      deadline_at: input.lease.expires_at,
    };
    await expect(firstRunner.execute(execution)).resolves.toEqual({
      kind: "FAILED",
      error_code: "ROOT_PROVIDER_CRASH",
    });
    const active = input.snapshots[0];
    if (!active) throw new Error("active tool checkpoint missing");
    expect(firstExecute).toHaveBeenCalledOnce();

    const resumedDecide = vi.fn(async () => ({
      ok: true as const,
      value: finalDecision(input),
    }));
    const resumedExecute = vi.fn(async () => ({
      status: "ACCEPTED" as const,
      reason_code: "ROOT_ANSWER_VERIFIED",
    }));
    const resumedRunner = createDataAgentTeamRunner({
      ...input.dependencies,
      root: { decide: resumedDecide },
      root_runtime: { execute: resumedExecute },
    });
    await expect(
      resumedRunner.execute({
        ...execution,
        restored_snapshot: active,
        context: input.createContext(),
      }),
    ).resolves.toEqual({ kind: "COMPLETED" });
    const resumedCalls = resumedDecide.mock.calls as unknown as Array<
      [unknown, { turn_index: number; tool_observations: RootToolObservation[] }]
    >;
    expect(resumedCalls[0]?.[1]).toMatchObject({
      turn_index: 1,
      tool_observations: [{ tool_call_id: "semantic-1" }],
    });
    expect(resumedExecute).toHaveBeenCalledOnce();
  });
});
