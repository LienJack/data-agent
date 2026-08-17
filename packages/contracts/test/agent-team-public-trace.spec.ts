import { describe, expect, it } from "vitest";
import { buildAgentTeamPublicTrace, verifyAgentTeamPublicTrace } from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("Agent Team public trace", () => {
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
