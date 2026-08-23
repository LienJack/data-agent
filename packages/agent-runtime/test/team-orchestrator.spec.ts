import { artifactReferenceIdentity } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILE_REVISIONS,
  authorizePersistedTaskCapability,
  buildTaskCapabilityReceipt,
  buildTeamTaskV2,
  createSubagentDelegationCommand,
  isAuthoritativeTaskCapability,
  taskCapabilityReceiptSchema,
} from "../src/teams/index.js";
import {
  APP_SCOPE,
  ARTIFACT_REF,
  CHILD_ATTEMPT_ID,
  CHILD_TASK_ID,
  PARENT_ATTEMPT_ID,
  PARENT_TASK_ID,
  RUN_ID,
} from "./fixtures/team.js";

const orchestratorProfile = AGENT_PROFILE_REVISIONS.find(
  (profile) => profile.profile_id === "data-agent-orchestrator",
);
const text2sqlProfile = AGENT_PROFILE_REVISIONS.find(
  (profile) => profile.profile_id === "governed-text2sql-agent",
);
if (!orchestratorProfile || !text2sqlProfile) throw new Error("missing U19 profile fixture");

const rootTaskInput = {
  schema_version: "agent-team-task@2.0.0",
  task_id: PARENT_TASK_ID,
  parent_task_id: null,
  parent_handoff_id: null,
  depth: 0,
  scope: APP_SCOPE,
  run_id: RUN_ID,
  profile_id: "data-agent-orchestrator",
  profile_revision: 1,
  profile_hash: orchestratorProfile.profile_hash,
  task_revision: 1,
  goal_revision: 1,
  attempt_id: PARENT_ATTEMPT_ID,
  worker_fence: 7,
  artifact_refs: [ARTIFACT_REF],
  context_epoch_ref: null,
  bounds: {
    max_context_bytes: 16_384,
    max_input_tokens: 4_000,
    max_output_tokens: 2_000,
    max_tool_calls: 3,
    timeout_ms: 60_000,
  },
  acceptance: {
    required_artifact_types: ["QueryEvidence"],
    require_all_verifier_dimensions: true,
  },
} as const;

async function capabilityFor(task = buildTeamTaskV2(rootTaskInput)) {
  return buildTaskCapabilityReceipt({
    schema_version: "task-capability-receipt@2.0.0",
    capability_id: "00000000-0000-4000-8000-000000000030",
    scope: APP_SCOPE,
    run_id: RUN_ID,
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    worker_fence: task.worker_fence,
    profile_id: task.profile_id,
    profile_revision: task.profile_revision,
    profile_hash: task.profile_hash,
    artifact_ref_identities: task.artifact_refs.map(artifactReferenceIdentity),
    operation_audiences: ["HANDOFF_PREPARE", "TASK_COMPLETE", "TOOL_INVOKE"],
    issuer: {
      principal_id: "00000000-0000-4000-8000-000000000031",
      key_id: "task-capability-signing-v1",
    },
    issued_at: "2026-08-17T00:00:00.000Z",
    expires_at: "2026-08-17T00:05:00.000Z",
    nonce: "00000000-0000-4000-8000-000000000032",
    revocation_version: 1,
  });
}

describe("Agent Team v2 orchestrator", () => {
  it("matches the PostgreSQL canonical Team Task hash vector", () => {
    const task = buildTeamTaskV2({
      schema_version: "agent-team-task@2.0.0",
      task_id: "00000000-0000-4000-8000-000000005810",
      parent_task_id: null,
      parent_handoff_id: null,
      depth: 0,
      scope: {
        app_id: "00000000-0000-4000-8000-00000000da01",
        tenant_id: "00000000-0000-4000-8000-000000005801",
        environment: "local",
      },
      run_id: "00000000-0000-4000-8000-000000005803",
      profile_id: "data-agent-orchestrator",
      profile_revision: 1,
      profile_hash: orchestratorProfile.profile_hash,
      task_revision: 1,
      goal_revision: 1,
      attempt_id: "00000000-0000-4000-8000-000000005806",
      worker_fence: 7,
      artifact_refs: [],
      context_epoch_ref: null,
      bounds: {
        max_context_bytes: 65_536,
        max_input_tokens: 1_000,
        max_output_tokens: 500,
        max_tool_calls: 4,
        timeout_ms: 30_000,
      },
      acceptance: {
        required_artifact_types: ["ReportManifest"],
        require_all_verifier_dimensions: true,
      },
    });
    expect(task.task_hash).toBe(
      "sha256:aa97e3490f63167df0851b429d284cfed403ecf5758909fd876f37fac21a7165",
    );
  });

  it("authorizes only a resolver-loaded exact TaskCapability and rejects clones", async () => {
    const task = buildTeamTaskV2(rootTaskInput);
    const receipt = await capabilityFor(task);
    const resolver = { resolve_committed: async () => receipt };
    const capability = await authorizePersistedTaskCapability(
      task,
      receipt.capability_id,
      resolver,
      {
        now: "2026-08-17T00:01:00.000Z",
        audience: "HANDOFF_PREPARE",
      },
    );
    expect(isAuthoritativeTaskCapability(capability)).toBe(true);
    expect(isAuthoritativeTaskCapability({ ...capability })).toBe(false);
    expect(taskCapabilityReceiptSchema.parse(receipt)).toEqual(receipt);
  });

  it("creates a fresh depth-1 child with narrowed refs and no parent raw history", async () => {
    const task = buildTeamTaskV2(rootTaskInput);
    const receipt = await capabilityFor(task);
    const capability = await authorizePersistedTaskCapability(
      task,
      receipt.capability_id,
      { resolve_committed: async () => receipt },
      { now: "2026-08-17T00:01:00.000Z", audience: "HANDOFF_PREPARE" },
    );
    const command = createSubagentDelegationCommand(task, capability, {
      schema_version: "subagent-delegation-request@2.0.0",
      handoff_id: "00000000-0000-4000-8000-000000000033",
      child_task_id: CHILD_TASK_ID,
      child_attempt_id: CHILD_ATTEMPT_ID,
      child_profile_id: "governed-text2sql-agent",
      parent_expected_revision: 1,
      objective_hash: `sha256:${"8".repeat(64)}`,
      artifact_refs: [ARTIFACT_REF],
      bounds: {
        max_context_bytes: 8_192,
        max_input_tokens: 2_000,
        max_output_tokens: 1_000,
        max_tool_calls: 2,
        timeout_ms: 30_000,
      },
      idempotency_key: "u19-text2sql-child",
    });
    expect(command.child_task.depth).toBe(1);
    expect(command.child_task.parent_task_id).toBe(PARENT_TASK_ID);
    expect(command.child_task.profile_id).toBe("governed-text2sql-agent");
    expect(JSON.stringify(command)).not.toContain("raw_history");
    expect(JSON.stringify(command)).not.toContain("secret");
  });

  it("rejects expired capability, recursive delegation and artifact expansion", async () => {
    const task = buildTeamTaskV2(rootTaskInput);
    const receipt = await capabilityFor(task);
    await expect(
      authorizePersistedTaskCapability(
        task,
        receipt.capability_id,
        { resolve_committed: async () => receipt },
        { now: "2026-08-17T00:06:00.000Z", audience: "HANDOFF_PREPARE" },
      ),
    ).rejects.toThrow("TASK_CAPABILITY_EXPIRED");

    const childTask = buildTeamTaskV2({
      ...rootTaskInput,
      task_id: CHILD_TASK_ID,
      parent_task_id: PARENT_TASK_ID,
      parent_handoff_id: "00000000-0000-4000-8000-000000000033",
      depth: 1,
      profile_id: "governed-text2sql-agent",
      profile_revision: 1,
      profile_hash: text2sqlProfile.profile_hash,
      attempt_id: CHILD_ATTEMPT_ID,
    });
    const childReceipt = await capabilityFor(childTask);
    const childCapability = await authorizePersistedTaskCapability(
      childTask,
      childReceipt.capability_id,
      { resolve_committed: async () => childReceipt },
      { now: "2026-08-17T00:01:00.000Z", audience: "HANDOFF_PREPARE" },
    );
    expect(() =>
      createSubagentDelegationCommand(childTask, childCapability, {
        schema_version: "subagent-delegation-request@2.0.0",
        handoff_id: "00000000-0000-4000-8000-000000000034",
        child_task_id: "00000000-0000-4000-8000-000000000035",
        child_attempt_id: "00000000-0000-4000-8000-000000000036",
        child_profile_id: "report-writing-agent",
        parent_expected_revision: 1,
        objective_hash: `sha256:${"8".repeat(64)}`,
        artifact_refs: [ARTIFACT_REF],
        bounds: childTask.bounds,
        idempotency_key: "recursive-child",
      }),
    ).toThrow("TEAM_RECURSIVE_DELEGATION_DENIED");
  });
});
