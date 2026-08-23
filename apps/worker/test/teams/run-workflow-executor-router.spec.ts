import { describe, expect, it, vi } from "vitest";
import { createRunWorkflowExecutorRouter } from "../../src/teams/run-workflow-executor-router.js";

const executeInput = (kind: "START_L2_RESEARCH" | "START_DATA_AGENT_TEAM") => {
  const effective_config_ref = {
    config_id: "00000000-0000-4000-8000-000000000001",
    config_revision: 1,
    config_hash: `sha256:${"1".repeat(64)}`,
  };
  const profile_refs = [
    {
      profile_id: "governed-text2sql-agent",
      revision: 1,
      revision_hash: `sha256:${"2".repeat(64)}`,
    },
    {
      profile_id: "report-writing-agent",
      revision: 1,
      revision_hash: `sha256:${"3".repeat(64)}`,
    },
    {
      profile_id: "semantic-management-agent",
      revision: 1,
      revision_hash: `sha256:${"4".repeat(64)}`,
    },
  ];
  return {
    lease: {
      command_kind: kind,
      payload:
        kind === "START_L2_RESEARCH"
          ? { kind, effective_config_ref }
          : { kind, effective_config_ref, profile_refs },
    },
  } as never;
};

describe("Run workflow executor router", () => {
  it("routes Team and Research commands to disjoint executors without fallback", async () => {
    const research = { execute: vi.fn(async () => ({ kind: "COMPLETED" as const })) };
    const team = { execute: vi.fn(async () => ({ kind: "COMPLETED" as const })) };
    const router = createRunWorkflowExecutorRouter({ research, team });
    await router.execute(executeInput("START_L2_RESEARCH"));
    await router.execute(executeInput("START_DATA_AGENT_TEAM"));
    expect(research.execute).toHaveBeenCalledTimes(1);
    expect(team.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects command/payload mismatch before either executor", async () => {
    const research = { execute: vi.fn() };
    const team = { execute: vi.fn() };
    const router = createRunWorkflowExecutorRouter({ research, team });
    const input = executeInput("START_DATA_AGENT_TEAM") as unknown as {
      lease: { command_kind: string; payload: { kind: string } };
    };
    input.lease.command_kind = "START_L2_RESEARCH";
    expect(() => router.execute(input as never)).toThrow("RUN_WORKFLOW_COMMAND_PAYLOAD_MISMATCH");
    expect(research.execute).not.toHaveBeenCalled();
    expect(team.execute).not.toHaveBeenCalled();
  });
});
