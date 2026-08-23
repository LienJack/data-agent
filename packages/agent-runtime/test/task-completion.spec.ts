import { artifactReferenceIdentity } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILE_REVISIONS,
  authorizePersistedTaskCapability,
  buildLateTaskResultAudit,
  buildTaskCapabilityReceipt,
  buildTaskCompletionReceipt,
  buildTeamTaskV2,
  buildVerifierDecision,
  decideTaskAcceptance,
  selectAcceptedTaskOutputRef,
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

const outputRef = {
  ...ARTIFACT_REF,
  artifact_id: "00000000-0000-4000-8000-000000000040",
  artifact_type: "QueryEvidence",
  content_hash: `sha256:${"9".repeat(64)}`,
};

const task = buildTeamTaskV2({
  schema_version: "agent-team-task@2.0.0",
  task_id: CHILD_TASK_ID,
  parent_task_id: "00000000-0000-4000-8000-000000000041",
  parent_handoff_id: "00000000-0000-4000-8000-000000000042",
  depth: 1,
  scope: APP_SCOPE,
  run_id: RUN_ID,
  profile_id: profile.profile_id,
  profile_revision: profile.revision,
  profile_hash: profile.profile_hash,
  task_revision: 3,
  goal_revision: 2,
  attempt_id: CHILD_ATTEMPT_ID,
  worker_fence: 7,
  artifact_refs: [ARTIFACT_REF, MODEL_VIEW_REF],
  context_epoch_ref: {
    epoch_id: "00000000-0000-4000-8000-000000000043",
    build_signature: `sha256:${"7".repeat(64)}`,
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

async function capability() {
  const receipt = await buildTaskCapabilityReceipt({
    schema_version: "task-capability-receipt@2.0.0",
    capability_id: "00000000-0000-4000-8000-000000000044",
    scope: APP_SCOPE,
    run_id: RUN_ID,
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    worker_fence: task.worker_fence,
    profile_id: task.profile_id,
    profile_revision: task.profile_revision,
    profile_hash: task.profile_hash,
    artifact_ref_identities: task.artifact_refs.map(artifactReferenceIdentity),
    operation_audiences: ["TASK_COMPLETE"],
    issuer: {
      principal_id: "00000000-0000-4000-8000-000000000045",
      key_id: "task-capability-signing-v1",
    },
    issued_at: "2026-08-17T00:00:00.000Z",
    expires_at: "2026-08-17T00:05:00.000Z",
    nonce: "00000000-0000-4000-8000-000000000046",
    revocation_version: 1,
  });
  return authorizePersistedTaskCapability(
    task,
    receipt.capability_id,
    { resolve_committed: async () => receipt },
    { now: "2026-08-17T00:01:00.000Z", audience: "TASK_COMPLETE" },
  );
}

describe("Team task completion and acceptance", () => {
  it("records completion independently from seven-dimensional acceptance", async () => {
    const completion = await buildTaskCompletionReceipt(task, await capability(), {
      schema_version: "task-completion-command@2.0.0",
      completion_id: "00000000-0000-4000-8000-000000000047",
      task_expected_revision: 3,
      output_ref: outputRef,
      completed_at: "2026-08-17T00:02:00.000Z",
      idempotency_key: "u19-query-evidence-completion",
    });
    expect(completion.status).toBe("COMPLETED");

    const verifier = await buildVerifierDecision({
      schema_version: "team-verifier-decision@2.0.0",
      decision_id: "00000000-0000-4000-8000-000000000048",
      task_id: task.task_id,
      task_revision: task.task_revision,
      completion_hash: completion.completion_hash,
      schema_valid: "PASS",
      scope_valid: "PASS",
      policy_valid: "PASS",
      provenance_valid: "PASS",
      execution_valid: "PASS",
      intent_grounded: "PASS",
      oracle_verified: "UNVERIFIED",
      semantic_status: "SEMANTICALLY_UNVERIFIED",
      decided_at: "2026-08-17T00:03:00.000Z",
    });
    const rejected = await decideTaskAcceptance({
      task,
      completion,
      verifier,
      coverage_hash: `sha256:${"6".repeat(64)}`,
      coverage_acceptance_blocked: false,
      blocking_obligation_ids: [],
      accepted_at: "2026-08-17T00:04:00.000Z",
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reason).toBe("VERIFIER_NOT_PASSED");
  });

  it("accepts only exact output with all dimensions passed and no blocking obligations", async () => {
    const completion = await buildTaskCompletionReceipt(task, await capability(), {
      schema_version: "task-completion-command@2.0.0",
      completion_id: "00000000-0000-4000-8000-000000000047",
      task_expected_revision: 3,
      output_ref: outputRef,
      completed_at: "2026-08-17T00:02:00.000Z",
      idempotency_key: "u19-query-evidence-completion",
    });
    const verifier = await buildVerifierDecision({
      schema_version: "team-verifier-decision@2.0.0",
      decision_id: "00000000-0000-4000-8000-000000000048",
      task_id: task.task_id,
      task_revision: task.task_revision,
      completion_hash: completion.completion_hash,
      schema_valid: "PASS",
      scope_valid: "PASS",
      policy_valid: "PASS",
      provenance_valid: "PASS",
      execution_valid: "PASS",
      intent_grounded: "PASS",
      oracle_verified: "PASS",
      semantic_status: "VERIFIED",
      decided_at: "2026-08-17T00:03:00.000Z",
    });
    const accepted = await decideTaskAcceptance({
      task,
      completion,
      verifier,
      coverage_hash: `sha256:${"6".repeat(64)}`,
      coverage_acceptance_blocked: false,
      blocking_obligation_ids: [],
      accepted_at: "2026-08-17T00:04:00.000Z",
    });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.reason).toBeNull();
    const acceptedRef = selectAcceptedTaskOutputRef({ completion, acceptance: accepted });
    expect(acceptedRef).toEqual(outputRef);

    const reportProfile = AGENT_PROFILE_REVISIONS.find(
      (entry) => entry.profile_id === "report-writing-agent",
    );
    if (!reportProfile) throw new Error("missing report profile");
    const { task_hash: _taskHash, ...taskDraft } = task;
    const reportTask = buildTeamTaskV2({
      ...taskDraft,
      task_id: "00000000-0000-4000-8000-000000000050",
      parent_task_id: "00000000-0000-4000-8000-000000000041",
      parent_handoff_id: "00000000-0000-4000-8000-000000000051",
      profile_id: reportProfile.profile_id,
      profile_revision: reportProfile.revision,
      profile_hash: reportProfile.profile_hash,
      attempt_id: "00000000-0000-4000-8000-000000000052",
      artifact_refs: [MODEL_VIEW_REF, acceptedRef],
      acceptance: {
        required_artifact_types: ["AnalysisReport"],
        require_all_verifier_dimensions: true,
      },
    });
    expect(reportTask.artifact_refs).toContainEqual(acceptedRef);
  });

  it("rejects candidate substitution, coverage gaps and completion hash tampering", async () => {
    await expect(
      buildTaskCompletionReceipt(task, await capability(), {
        schema_version: "task-completion-command@2.0.0",
        completion_id: "00000000-0000-4000-8000-000000000047",
        task_expected_revision: 3,
        output_ref: { ...outputRef, artifact_type: "SemanticGraphCandidate" },
        completed_at: "2026-08-17T00:02:00.000Z",
        idempotency_key: "u19-query-evidence-completion",
      }),
    ).rejects.toThrow("TEAM_OUTPUT_TYPE_NOT_ALLOWED");
  });

  it("hashes late results as ignored audit evidence without creating completion", async () => {
    const audit = await buildLateTaskResultAudit({
      schema_version: "late-task-result-audit@2.0.0",
      event_id: "00000000-0000-4000-8000-000000000049",
      task_id: task.task_id,
      task_revision: task.task_revision,
      attempt_id: task.attempt_id,
      worker_fence: task.worker_fence,
      result_hash: `sha256:${"8".repeat(64)}`,
      reason: "LEASE_EXPIRED",
      observed_at: "2026-08-17T00:06:00.000Z",
    });
    expect(audit.reason).toBe("LEASE_EXPIRED");
    expect(audit.event_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect("completion_hash" in audit).toBe(false);
  });

  it("does not expose semantically unverified candidate output to downstream tasks", async () => {
    const completion = await buildTaskCompletionReceipt(task, await capability(), {
      schema_version: "task-completion-command@2.0.0",
      completion_id: "00000000-0000-4000-8000-000000000053",
      task_expected_revision: 3,
      output_ref: outputRef,
      completed_at: "2026-08-17T00:02:00.000Z",
      idempotency_key: "u19-unverified-output",
    });
    const verifier = await buildVerifierDecision({
      schema_version: "team-verifier-decision@2.0.0",
      decision_id: "00000000-0000-4000-8000-000000000054",
      task_id: task.task_id,
      task_revision: task.task_revision,
      completion_hash: completion.completion_hash,
      schema_valid: "PASS",
      scope_valid: "PASS",
      policy_valid: "PASS",
      provenance_valid: "PASS",
      execution_valid: "PASS",
      intent_grounded: "PASS",
      oracle_verified: "UNVERIFIED",
      semantic_status: "SEMANTICALLY_UNVERIFIED",
      decided_at: "2026-08-17T00:03:00.000Z",
    });
    const acceptance = await decideTaskAcceptance({
      task,
      completion,
      verifier,
      coverage_hash: `sha256:${"6".repeat(64)}`,
      coverage_acceptance_blocked: false,
      blocking_obligation_ids: [],
      accepted_at: "2026-08-17T00:04:00.000Z",
    });
    expect(() => selectAcceptedTaskOutputRef({ completion, acceptance })).toThrow(
      "TEAM_OUTPUT_NOT_ACCEPTED",
    );
  });
});
