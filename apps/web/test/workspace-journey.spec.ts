import { describe, expect, it } from "vitest";
import {
  GREENFIELD_STAGE_DEFINITIONS,
  RECOVERY_REASON_CODES,
  recoveryPolicyFor,
  WORKSPACE_STATUS_AXES,
} from "@/lib/workspace-journey";

describe("Workspace journey policy", () => {
  it("allows QA only after the initial release is published", () => {
    expect(
      GREENFIELD_STAGE_DEFINITIONS.filter((definition) => !definition.blocks_qa).map(
        ({ stage }) => stage,
      ),
    ).toEqual(["PUBLISHED_V1_READY"]);
  });

  it("keeps task, evidence, benchmark and release as independent axes", () => {
    expect(WORKSPACE_STATUS_AXES.map(({ axis }) => axis)).toEqual([
      "TASK",
      "EVIDENCE",
      "BENCHMARK",
      "RELEASE",
    ]);
    expect(WORKSPACE_STATUS_AXES[2]?.states).toContain("TEST_UNSCORED");
  });

  it("maps every recovery reason to one constrained action", () => {
    expect(RECOVERY_REASON_CODES.map((reason) => recoveryPolicyFor(reason).action)).toEqual([
      "REQUEST_ACCESS",
      "OPEN_DEPENDENCY",
      "CREATE_NEW_TASK",
      "RESUME",
      "SELECT_CERTIFIED_PROFILE",
      "WAIT_BACKOFF",
      "VIEW_PARTIAL_OR_NARROW_SCOPE",
      "EXPLAIN_ONLY",
      "RECONCILE",
    ]);
    expect(recoveryPolicyFor("OUTCOME_UNKNOWN")).toEqual({
      reason_code: "OUTCOME_UNKNOWN",
      action: "RECONCILE",
      retry_allowed: false,
      resume_allowed: false,
    });
    expect(recoveryPolicyFor("EXECUTION_LIMIT_REACHED").resume_allowed).toBe(false);
  });
});
