import { describe, expect, it } from "vitest";
import {
  advanceContextEpochTransition,
  buildOpenObligationLedger,
  createContextEpochTransition,
  recoverContextEpoch,
} from "../src/mastra/context-epoch-adapter.js";

const currentEpoch = {
  epoch_id: "00000000-0000-4000-8000-000000000050",
  build_signature: `sha256:${"1".repeat(64)}`,
};
const proposedEpoch = {
  epoch_id: "00000000-0000-4000-8000-000000000051",
  build_signature: `sha256:${"2".repeat(64)}`,
};

async function obligations(status: "OPEN" | "UNKNOWN" = "OPEN") {
  return buildOpenObligationLedger({
    schema_version: "open-obligation-ledger@2.0.0",
    task_id: "00000000-0000-4000-8000-000000000052",
    task_revision: 3,
    obligations: [
      {
        obligation_id: "00000000-0000-4000-8000-000000000053",
        kind: "GOAL_CONSTRAINT",
        status,
        subject_hash: `sha256:${"3".repeat(64)}`,
      },
    ],
  });
}

describe("Context epoch recovery", () => {
  it("keeps the old epoch active at every pre-activation kill point", async () => {
    const current = await obligations();
    let transition = await createContextEpochTransition({
      transition_id: "00000000-0000-4000-8000-000000000054",
      current_epoch: currentEpoch,
      proposed_epoch: proposedEpoch,
      current_obligations: current,
      proposed_obligations: current,
    });
    for (const phase of ["SUMMARY_COMMITTED", "REPLACEMENT_COMMITTED", "PROBE_PASSED"] as const) {
      transition = await advanceContextEpochTransition(transition, phase);
      expect(recoverContextEpoch(currentEpoch, transition).active_epoch).toEqual(currentEpoch);
    }
    transition = await advanceContextEpochTransition(transition, "ACTIVATED");
    expect(recoverContextEpoch(currentEpoch, transition).active_epoch).toEqual(proposedEpoch);
  });

  it("refuses activation when obligation ids/statuses are not set-equivalent", async () => {
    const current = await obligations("OPEN");
    const proposed = await obligations("UNKNOWN");
    let transition = await createContextEpochTransition({
      transition_id: "00000000-0000-4000-8000-000000000054",
      current_epoch: currentEpoch,
      proposed_epoch: proposedEpoch,
      current_obligations: current,
      proposed_obligations: proposed,
    });
    transition = await advanceContextEpochTransition(transition, "SUMMARY_COMMITTED");
    transition = await advanceContextEpochTransition(transition, "REPLACEMENT_COMMITTED");
    transition = await advanceContextEpochTransition(transition, "PROBE_PASSED");
    await expect(advanceContextEpochTransition(transition, "ACTIVATED")).rejects.toThrow(
      "TEAM_OBLIGATION_SET_MISMATCH",
    );
  });

  it("does not permit unknown effects to disappear during compaction", async () => {
    const current = await buildOpenObligationLedger({
      schema_version: "open-obligation-ledger@2.0.0",
      task_id: "00000000-0000-4000-8000-000000000052",
      task_revision: 3,
      obligations: [
        {
          obligation_id: "00000000-0000-4000-8000-000000000053",
          kind: "PENDING_EFFECT",
          status: "UNKNOWN",
          subject_hash: `sha256:${"3".repeat(64)}`,
        },
      ],
    });
    const empty = await buildOpenObligationLedger({
      schema_version: "open-obligation-ledger@2.0.0",
      task_id: "00000000-0000-4000-8000-000000000052",
      task_revision: 3,
      obligations: [],
    });
    await expect(
      createContextEpochTransition({
        transition_id: "00000000-0000-4000-8000-000000000054",
        current_epoch: currentEpoch,
        proposed_epoch: proposedEpoch,
        current_obligations: current,
        proposed_obligations: empty,
      }),
    ).resolves.toBeDefined();

    let transition = await createContextEpochTransition({
      transition_id: "00000000-0000-4000-8000-000000000055",
      current_epoch: currentEpoch,
      proposed_epoch: proposedEpoch,
      current_obligations: current,
      proposed_obligations: current,
    });
    transition = await advanceContextEpochTransition(transition, "SUMMARY_COMMITTED");
    transition = await advanceContextEpochTransition(transition, "REPLACEMENT_COMMITTED");
    transition = await advanceContextEpochTransition(transition, "PROBE_PASSED");
    await expect(advanceContextEpochTransition(transition, "ACTIVATED")).rejects.toThrow(
      "TEAM_PENDING_EFFECT_RECONCILIATION_REQUIRED",
    );
  });
});
