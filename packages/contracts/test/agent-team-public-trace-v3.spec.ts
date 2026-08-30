import { describe, expect, it } from "vitest";
import { buildAgentTeamPublicTrace, verifyAgentTeamPublicTrace } from "../src/index.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = `sha256:${"1".repeat(64)}`;
function draft() {
  const root = {
    task_id: id(10),
    parent_task_id: null as string | null,
    depth: 0,
    profile_id: "data-agent-orchestrator",
    profile_revision: 1,
    profile_hash: hash,
    task_revision: 1,
    attempt_id: id(20),
    worker_fence: 1,
    status: "COMPLETED",
    created_at: "2026-08-30T00:00:00.000Z",
    goal_revision: 1,
    bounds: {
      max_context_bytes: 1000,
      max_input_tokens: 1000,
      max_output_tokens: 1000,
      max_tool_calls: 2,
      timeout_ms: 1000,
    },
    required_artifact_types: ["AnalysisReport"],
    artifact_refs: [],
    context_epoch_ref: null,
    completion: null,
    acceptance: null,
    status_source: {
      kind: "RUN_EVENT",
      event_id: id(30),
      sequence: 3,
      event_hash: hash,
      occurred_at: "2026-08-30T00:00:01.000Z",
      status: "COMPLETED",
    },
  };
  return {
    schema_version: "agent-team-public-trace@3.0.0",
    scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
    run_id: id(3),
    tasks: [
      root,
      {
        ...root,
        task_id: id(11),
        attempt_id: id(21),
        status_source: { ...root.status_source, event_id: id(31), sequence: 5 },
      },
    ],
    handoffs: [],
    epochs: [],
    verifier_decisions: [],
  };
}

describe("current Team public trace V3", () => {
  it("retains multiple real Root rounds with exact public status evidence and stable hashes", async () => {
    const trace = await buildAgentTeamPublicTrace(draft());
    expect(trace.tasks).toHaveLength(2);
    await expect(verifyAgentTeamPublicTrace(trace)).resolves.toEqual(trace);
    expect(trace.tasks.every((task) => "completion" in task && task.completion === null)).toBe(
      true,
    );
    await expect(
      verifyAgentTeamPublicTrace({ ...trace, trace_hash: `sha256:${"2".repeat(64)}` }),
    ).rejects.toThrow("HASH_MISMATCH");
  });

  it("does not weaken the legacy V2 single-root contract", async () => {
    const value = draft();
    await expect(
      buildAgentTeamPublicTrace({
        ...value,
        schema_version: "agent-team-public-trace@2.0.0",
        tasks: value.tasks.map(({ status_source: _source, ...task }) => task),
      }),
    ).rejects.toThrow("exactly one root");
  });

  it("accepts current Profile IDs only under a real Root task", async () => {
    const value = draft();
    const root = value.tasks[0];
    if (!root) throw new Error("root fixture missing");
    value.tasks.push({
      ...root,
      task_id: id(12),
      parent_task_id: id(10),
      depth: 1,
      profile_id: "governed-analysis-agent",
      status_source: {
        ...root.status_source,
        event_id: id(32),
        sequence: 6,
      },
    });
    await expect(buildAgentTeamPublicTrace(value)).resolves.toMatchObject({
      tasks: expect.any(Array),
    });
    const child = value.tasks[2];
    if (!child) throw new Error("child fixture missing");
    child.parent_task_id = id(12);
    await expect(buildAgentTeamPublicTrace(value)).rejects.toThrow("parent must be a root");
  });

  it.each([
    "status mismatch",
    "missing receipt",
    "no event means pending",
    "cross-run artifact",
    "unsorted tasks",
    "zero roots",
  ])("rejects %s", async (kind) => {
    const value = draft();
    const task: Record<string, unknown> | undefined = value.tasks[0];
    if (!task) throw new Error("task fixture missing");
    if (kind === "status mismatch") task.status = "FAILED";
    if (kind === "missing receipt") task.status_source = { kind: "TEAM_RECEIPT" };
    if (kind === "no event means pending") task.status_source = { kind: "TASK_RECORD" };
    if (kind === "cross-run artifact")
      task.artifact_refs = [
        {
          ...value.scope,
          artifact_id: id(80),
          artifact_type: "AnalysisReport",
          run_id: id(90),
          revision: 1,
          content_hash: hash,
        },
      ];
    if (kind === "unsorted tasks") value.tasks.reverse();
    if (kind === "zero roots") value.tasks = [];
    await expect(buildAgentTeamPublicTrace(value)).rejects.toThrow();
  });
});
