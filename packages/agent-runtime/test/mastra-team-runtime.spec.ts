import { describe, expect, it } from "vitest";
import { MastraTeamRuntime } from "../src/mastra/mastra-team-runtime.js";
import {
  AGENT_PROFILE_REVISIONS,
  buildTeamTaskV2,
  TeamWorkflowRegistry,
} from "../src/teams/index.js";
import {
  APP_SCOPE,
  ARTIFACT_REF,
  CHILD_ATTEMPT_ID,
  CHILD_TASK_ID,
  MODEL_VIEW_REF,
  RUN_ID,
} from "./fixtures/team.js";

const profile = AGENT_PROFILE_REVISIONS.find(
  (entry) => entry.profile_id === "governed-text2sql-agent",
);
if (!profile) throw new Error("missing profile");

const task = buildTeamTaskV2({
  schema_version: "agent-team-task@2.0.0",
  task_id: CHILD_TASK_ID,
  parent_task_id: "00000000-0000-4000-8000-000000000060",
  parent_handoff_id: "00000000-0000-4000-8000-000000000061",
  depth: 1,
  scope: APP_SCOPE,
  run_id: RUN_ID,
  profile_id: profile.profile_id,
  profile_revision: profile.revision,
  profile_hash: profile.profile_hash,
  task_revision: 1,
  goal_revision: 1,
  attempt_id: CHILD_ATTEMPT_ID,
  worker_fence: 7,
  artifact_refs: [ARTIFACT_REF, MODEL_VIEW_REF],
  context_epoch_ref: {
    epoch_id: "00000000-0000-4000-8000-000000000062",
    build_signature: `sha256:${"2".repeat(64)}`,
  },
  bounds: {
    max_context_bytes: 8_192,
    max_input_tokens: 2_000,
    max_output_tokens: 1_000,
    max_tool_calls: 2,
    timeout_ms: 30_000,
  },
  acceptance: {
    required_artifact_types: ["QueryEvidence"],
    require_all_verifier_dimensions: true,
  },
});

describe("Mastra Team Runtime", () => {
  it("rehydrates from authority on every run and treats snapshot as execution-only", async () => {
    let loads = 0;
    const snapshots: unknown[] = [];
    const registry = new TeamWorkflowRegistry();
    registry.register(profile, async ({ task: loadedTask }) => ({
      status: "COMPLETED",
      task_id: loadedTask.task_id,
      output_ref: {
        ...ARTIFACT_REF,
        artifact_id: "00000000-0000-4000-8000-000000000063",
        artifact_type: "QueryEvidence",
      },
    }));
    const runtime = new MastraTeamRuntime({
      authority: {
        loadTask: async () => {
          loads += 1;
          return task;
        },
        loadContextEpoch: async () => ({
          epoch_id: task.context_epoch_ref?.epoch_id,
          build_signature: task.context_epoch_ref?.build_signature,
        }),
        recordExecutionSnapshot: async (snapshot) => {
          snapshots.push(snapshot);
        },
      },
      workflows: registry,
    });
    const result = await runtime.execute(task.task_id);
    expect(result.status).toBe("COMPLETED");
    expect(loads).toBe(2);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ authority: "EXECUTION_SNAPSHOT_ONLY" });
  });

  it("fails closed before workflow execution when authority drifts", async () => {
    let calls = 0;
    let loads = 0;
    const registry = new TeamWorkflowRegistry();
    registry.register(profile, async () => {
      calls += 1;
      throw new Error("must not execute");
    });
    const { task_hash: _taskHash, ...taskDraft } = task;
    const driftedTask = buildTeamTaskV2({ ...taskDraft, task_revision: 2 });
    const runtime = new MastraTeamRuntime({
      authority: {
        loadTask: async () => {
          loads += 1;
          return loads === 1 ? task : driftedTask;
        },
        loadContextEpoch: async () => task.context_epoch_ref,
        recordExecutionSnapshot: async () => undefined,
      },
      workflows: registry,
    });
    await expect(runtime.execute(task.task_id)).rejects.toThrow("TEAM_TASK_AUTHORITY_DRIFT");
    expect(calls).toBe(0);
  });
});
