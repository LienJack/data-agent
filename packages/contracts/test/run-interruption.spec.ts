import { describe, expect, it } from "vitest";
import {
  buildInterruptionReplyCommand,
  buildRunInterruption,
  buildRunInterruptionOpenCommand,
  buildSessionBranch,
  buildSessionBranchCommand,
  runRuntimeEventSchema,
  verifyInterruptionReplyCommand,
  verifyRunInterruption,
  verifySessionBranchCommand,
} from "../src/runs/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const timestamp = "2026-08-17T12:00:00.000Z";

async function interruption() {
  return buildRunInterruption({
    schema_version: "run-interruption@1.0.0",
    scope,
    interruption_id: id(3),
    run_id: id(4),
    kind: "CLARIFICATION",
    question: "Which revenue definition should be used?",
    options: [
      { option_id: "booked", label: "Booked revenue" },
      { option_id: "recognized", label: "Recognized revenue" },
    ],
    checkpoint_ref: { snapshot_id: id(5), snapshot_version: 2, snapshot_hash: hash("1") },
    worker_fence: 7,
    state: "OPEN",
    version: 1,
    opened_at: timestamp,
    answered_at: null,
  });
}

describe("run interruption and session branch contracts", () => {
  it("hashes an OPEN interruption and rejects question or option-order tampering", async () => {
    const value = await interruption();
    await expect(verifyRunInterruption(value)).resolves.toEqual(value);
    await expect(verifyRunInterruption({ ...value, question: "Use net revenue?" })).rejects.toThrow(
      "RUN_INTERRUPTION_HASH_MISMATCH",
    );
    await expect(
      buildRunInterruption({
        ...value,
        interruption_hash: undefined,
        options: [...value.options].reverse(),
      }),
    ).rejects.toThrow();
  });

  it("binds open and reply commands to exact actor/version/fence identities", async () => {
    const value = await interruption();
    const opened = await buildRunInterruptionOpenCommand({
      schema_version: "run-interruption-open-command@1.0.0",
      operation_id: id(6),
      idempotency_key: "interruption:open:1",
      actor_principal_id: id(7),
      interruption: value,
    });
    expect(opened.command_hash).toMatch(/^sha256:/);

    const reply = await buildInterruptionReplyCommand({
      schema_version: "interruption-reply-command@1.0.0",
      operation_id: id(8),
      idempotency_key: "interruption:reply:1",
      scope,
      run_id: value.run_id,
      interruption_id: value.interruption_id,
      expected_version: 1,
      expected_worker_fence: 7,
      actor_principal_id: id(7),
      response: { kind: "OPTION", option_id: "booked" },
      submitted_at: timestamp,
    });
    await expect(verifyInterruptionReplyCommand(reply)).resolves.toEqual(reply);
    await expect(
      verifyInterruptionReplyCommand({ ...reply, actor_principal_id: id(9) }),
    ).rejects.toThrow("INTERRUPTION_REPLY_COMMAND_HASH_MISMATCH");
    await expect(verifyInterruptionReplyCommand({ ...reply, expected_version: 2 })).rejects.toThrow(
      "INTERRUPTION_REPLY_COMMAND_HASH_MISMATCH",
    );
  });

  it("creates a reference-only branch with exact checkpoint and config revalidation", async () => {
    const branch = await buildSessionBranch({
      schema_version: "session-branch@1.0.0",
      scope,
      branch_id: id(10),
      parent_conversation_id: id(11),
      parent_run_id: id(4),
      parent_event_sequence: 12,
      parent_checkpoint_ref: {
        snapshot_id: id(5),
        snapshot_version: 2,
        snapshot_hash: hash("1"),
      },
      effective_config_revalidation: {
        receipt_id: id(12),
        receipt_hash: hash("2"),
        config_ref: { config_id: id(13), config_revision: 1, config_hash: hash("3") },
        revalidated_at: timestamp,
      },
      child_conversation_id: id(14),
      created_by_principal_id: id(7),
      created_at: timestamp,
    });
    const command = await buildSessionBranchCommand({
      schema_version: "session-branch-command@1.0.0",
      operation_id: id(15),
      idempotency_key: "session:branch:1",
      branch,
    });
    await expect(verifySessionBranchCommand(command)).resolves.toEqual(command);
    await expect(
      verifySessionBranchCommand({
        ...command,
        branch: { ...branch, child_conversation_id: id(16) },
      }),
    ).rejects.toThrow();
    expect(JSON.stringify(branch)).not.toMatch(/messages|events|artifact_payload|effect_payload/);
  });

  it("reads legacy and interruption-aware suspension events without changing event identity", () => {
    const common = {
      schema_version: "1.0.0",
      event_id: id(20),
      scope,
      run_id: id(4),
      sequence: 4,
      worker_fence: 7,
      idempotency_key: "suspend:1",
      occurred_at: timestamp,
      event_type: "run.suspended",
    } as const;
    expect(
      runRuntimeEventSchema.parse({
        ...common,
        payload: { reason_code: "CLARIFICATION_REQUIRED", snapshot_id: id(5) },
      }).event_type,
    ).toBe("run.suspended");
    expect(
      runRuntimeEventSchema.parse({
        ...common,
        payload: {
          reason_code: "CLARIFICATION_REQUIRED",
          snapshot_id: id(5),
          interruption_id: id(3),
          interruption_version: 1,
        },
      }).event_type,
    ).toBe("run.suspended");
  });
});
