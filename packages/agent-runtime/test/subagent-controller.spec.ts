import { describe, expect, it } from "vitest";
import { createPersistedSubagentController } from "../src/mastra/subagent-controller.js";
import { buildTaskCapabilityReceipt, buildTeamTaskV2 } from "../src/teams/index.js";

const ids = {
  run: "10000000-0000-4000-8000-000000000001",
  parent: "10000000-0000-4000-8000-000000000002",
  child: "10000000-0000-4000-8000-000000000003",
  parentAttempt: "10000000-0000-4000-8000-000000000004",
  childAttempt: "10000000-0000-4000-8000-000000000005",
  handoff: "10000000-0000-4000-8000-000000000006",
  capability: "10000000-0000-4000-8000-000000000007",
  nonce: "10000000-0000-4000-8000-000000000008",
  principal: "10000000-0000-4000-8000-000000000009",
} as const;

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "10000000-0000-4000-8000-000000000010",
  environment: "test",
} as const;

function parentTask() {
  return buildTeamTaskV2({
    schema_version: "agent-team-task@2.0.0",
    task_id: ids.parent,
    parent_task_id: null,
    parent_handoff_id: null,
    depth: 0,
    scope,
    run_id: ids.run,
    profile_id: "data-agent-orchestrator",
    profile_revision: 1,
    profile_hash: "sha256:c46b9eb899fe2dd1592b914b509268b8281736ad223181be5a4e998ecd9eddad",
    task_revision: 1,
    goal_revision: 1,
    attempt_id: ids.parentAttempt,
    worker_fence: 1,
    artifact_refs: [],
    context_epoch_ref: null,
    bounds: {
      max_context_bytes: 65536,
      max_input_tokens: 1000,
      max_output_tokens: 500,
      max_tool_calls: 4,
      timeout_ms: 30_000,
    },
    acceptance: {
      required_artifact_types: ["ReportManifest"],
      require_all_verifier_dimensions: true,
    },
  });
}

describe("persisted subagent controller", () => {
  it("loads committed capability before creating one depth-1 handoff", async () => {
    const parent = parentTask();
    const capability = await buildTaskCapabilityReceipt({
      schema_version: "task-capability-receipt@2.0.0",
      capability_id: ids.capability,
      scope,
      run_id: ids.run,
      task_id: ids.parent,
      attempt_id: ids.parentAttempt,
      worker_fence: 1,
      profile_id: parent.profile_id,
      profile_revision: 1,
      profile_hash: parent.profile_hash,
      artifact_ref_identities: [],
      operation_audiences: ["HANDOFF_PREPARE"],
      issuer: { principal_id: ids.principal, key_id: "team-key@1" },
      issued_at: "2026-08-17T00:00:00.000Z",
      expires_at: "2026-08-17T00:05:00.000Z",
      nonce: ids.nonce,
      revocation_version: 1,
    });
    const committed: unknown[] = [];
    const controller = createPersistedSubagentController({
      capabilities: { resolve_committed: async () => capability },
      handoffs: { prepareHandoff: async (command) => committed.push(command) },
      now: () => "2026-08-17T00:01:00.000Z",
    });
    const command = await controller.delegate({
      parent_task: parent,
      capability_id: ids.capability,
      request: {
        schema_version: "subagent-delegation-request@2.0.0",
        handoff_id: ids.handoff,
        child_task_id: ids.child,
        child_attempt_id: ids.childAttempt,
        child_profile_id: "governed-text2sql-agent",
        parent_expected_revision: 1,
        objective_hash: `sha256:${"1".repeat(64)}`,
        artifact_refs: [],
        bounds: {
          max_context_bytes: 32000,
          max_input_tokens: 500,
          max_output_tokens: 250,
          max_tool_calls: 2,
          timeout_ms: 20_000,
        },
        idempotency_key: "handoff-001",
      },
    });
    expect(command.child_task.depth).toBe(1);
    expect(committed).toEqual([command]);
  });

  it("rejects a cloned capability that was not resolved from committed authority", async () => {
    const controller = createPersistedSubagentController({
      capabilities: { resolve_committed: async () => null },
      handoffs: { prepareHandoff: async () => undefined },
      now: () => "2026-08-17T00:01:00.000Z",
    });
    await expect(
      controller.delegate({
        parent_task: parentTask(),
        capability_id: ids.capability,
        request: {},
      }),
    ).rejects.toThrow("TASK_CAPABILITY_NOT_FOUND");
  });
});
