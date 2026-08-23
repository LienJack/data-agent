import { describe, expect, it } from "vitest";
import { buildAgentTeamPublicTrace, verifyAgentTeamPublicTrace } from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Agent Team public trace", () => {
  it("projects content-first v2 task, context and verification fields with closed identities", async () => {
    const outputRef = {
      artifact_id: id(60),
      artifact_type: "AnalysisReport" as const,
      app_id: id(1),
      tenant_id: id(2),
      environment: "test",
      run_id: id(3),
      revision: 2,
      content_hash: hash("8"),
    };
    const trace = await buildAgentTeamPublicTrace({
      schema_version: "agent-team-public-trace@2.0.0",
      scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
      run_id: id(3),
      tasks: [
        {
          task_id: id(10),
          parent_task_id: null,
          depth: 0,
          profile_id: "data-agent-orchestrator",
          profile_revision: 1,
          profile_hash: hash("1"),
          task_revision: 2,
          attempt_id: id(20),
          worker_fence: 2,
          status: "ACCEPTED",
          created_at: "2026-08-18T12:00:00.000Z",
          goal_revision: 4,
          bounds: {
            max_context_bytes: 32_768,
            max_input_tokens: 8_000,
            max_output_tokens: 2_000,
            max_tool_calls: 12,
            timeout_ms: 120_000,
          },
          required_artifact_types: ["AnalysisReport"],
          artifact_refs: [],
          context_epoch_ref: { epoch_id: id(40), build_signature: hash("4") },
          completion: { output_ref: outputRef, completed_at: "2026-08-18T12:00:02.000Z" },
          acceptance: {
            status: "ACCEPTED",
            reason: null,
            accepted_at: "2026-08-18T12:00:04.000Z",
          },
        },
      ],
      handoffs: [],
      epochs: [
        {
          task_id: id(10),
          epoch_id: id(40),
          epoch_revision: 1,
          phase: "ACTIVATED",
          build_signature: hash("4"),
          obligation_ledger_hash: hash("5"),
          created_at: "2026-08-18T12:00:01.000Z",
          obligation_counts: { total: 3, open: 0, unknown: 0, resolved: 3 },
        },
      ],
      verifier_decisions: [
        {
          task_id: id(10),
          task_revision: 2,
          decision_id: id(50),
          completion_hash: hash("6"),
          decision_hash: hash("7"),
          created_at: "2026-08-18T12:00:03.000Z",
          dimensions: {
            schema_valid: "PASS",
            scope_valid: "PASS",
            policy_valid: "PASS",
            provenance_valid: "PASS",
            execution_valid: "PASS",
            intent_grounded: "PASS",
            oracle_verified: "PASS",
          },
          semantic_status: "VERIFIED",
          decided_at: "2026-08-18T12:00:03.000Z",
          acceptance: {
            status: "ACCEPTED",
            reason: null,
            accepted_at: "2026-08-18T12:00:04.000Z",
          },
        },
      ],
    });

    await expect(verifyAgentTeamPublicTrace(trace)).resolves.toEqual(trace);
    expect(trace.schema_version).toBe("agent-team-public-trace@2.0.0");
    if (trace.schema_version !== "agent-team-public-trace@2.0.0") {
      throw new Error("v2 fixture unexpectedly parsed as v1");
    }
    expect(JSON.stringify(trace)).not.toMatch(/prompt|raw_context|secretref|tool_args/i);
    await expect(
      verifyAgentTeamPublicTrace({ ...trace, provider_payload: { authorization: "secret" } }),
    ).rejects.toThrow();
    const { trace_hash: _traceHash, ...draft } = trace;
    await expect(
      buildAgentTeamPublicTrace({
        ...draft,
        epochs: trace.epochs.map((epoch) => ({
          ...epoch,
          obligation_counts: { ...epoch.obligation_counts, open: 1 },
        })),
      }),
    ).rejects.toThrow("Team obligation counts do not close");
  });

  it("hashes a closed task/handoff/epoch/verifier graph without private payloads", async () => {
    const trace = await buildAgentTeamPublicTrace({
      schema_version: "agent-team-public-trace@1.0.0",
      scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
      run_id: id(3),
      tasks: [
        {
          task_id: id(10),
          parent_task_id: null,
          depth: 0,
          profile_id: "data-agent-orchestrator",
          profile_revision: 1,
          profile_hash: hash("1"),
          task_revision: 1,
          attempt_id: id(20),
          worker_fence: 1,
          status: "RUNNING",
          created_at: "2026-08-18T12:00:00.000Z",
        },
        {
          task_id: id(11),
          parent_task_id: id(10),
          depth: 1,
          profile_id: "governed-text2sql-agent",
          profile_revision: 1,
          profile_hash: hash("2"),
          task_revision: 1,
          attempt_id: id(21),
          worker_fence: 1,
          status: "ACCEPTED",
          created_at: "2026-08-18T12:00:01.000Z",
        },
      ],
      handoffs: [
        {
          handoff_id: id(30),
          parent_task_id: id(10),
          child_task_id: id(11),
          parent_expected_revision: 1,
          request_hash: hash("3"),
          created_at: "2026-08-18T12:00:01.000Z",
        },
      ],
      epochs: [
        {
          task_id: id(11),
          epoch_id: id(40),
          epoch_revision: 1,
          phase: "ACTIVATED",
          build_signature: hash("4"),
          obligation_ledger_hash: hash("5"),
          created_at: "2026-08-18T12:00:02.000Z",
        },
      ],
      verifier_decisions: [
        {
          task_id: id(11),
          task_revision: 1,
          decision_id: id(50),
          completion_hash: hash("6"),
          decision_hash: hash("7"),
          created_at: "2026-08-18T12:00:03.000Z",
        },
      ],
    });
    await expect(verifyAgentTeamPublicTrace(trace)).resolves.toEqual(trace);
    expect(JSON.stringify(trace)).not.toMatch(
      /prompt|message|reasoning|context_payload|tool_args/i,
    );
    await expect(
      verifyAgentTeamPublicTrace({
        ...trace,
        tasks: trace.tasks.map((task, index) =>
          index === 1 ? { ...task, status: "REJECTED" } : task,
        ),
      }),
    ).rejects.toThrow("AGENT_TEAM_PUBLIC_TRACE_HASH_MISMATCH");
  });
});
