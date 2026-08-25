import { describe, expect, it } from "vitest";
import {
  assertFalcon24AcceptanceExecutionBinding,
  FALCON24_STRICT_ACCEPTANCE_EXECUTION_POLICY,
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  loadFalcon24StrictAcceptanceExecutionPolicy,
} from "../../src/evals/falcon24-acceptance-execution-policy.js";

describe("Falcon24 strict acceptance execution policy", () => {
  it("freezes every retry, repair, and recovery surface at one attempt or zero repair", () => {
    expect(FALCON24_STRICT_ACCEPTANCE_EXECUTION_POLICY).toEqual({
      schema_version: "falcon24-acceptance-execution-policy@1.0.0",
      policy_id: FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
      mode: "FALCON24_STRICT",
      max_run_attempts: 1,
      max_provider_attempts_per_call: 1,
      max_root_turns: 1,
      max_text2sql_candidate_attempts: 1,
      analysis_repair_budget_per_category: 0,
      max_file_transfer_attempts: 1,
      allow_stage_recovery: false,
      suite_failure_behavior: "STOP_IMMEDIATELY",
      automatic_version_escalation: false,
      next_version_change_requirement: "CODE_OR_FROZEN_CONTRACT",
      failure_localization_order: [
        "ROOT_ROUTING",
        "SQL_DATA_PREPARATION",
        "GOVERNED_OPERATOR",
        "ORACLE",
        "PUBLISHER",
        "SANDBOX_RECLAMATION",
      ],
    });
  });

  it("fails closed on an unknown policy id", () => {
    expect(() =>
      loadFalcon24StrictAcceptanceExecutionPolicy({
        DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY: "falcon24-unknown@1",
      }),
    ).toThrow("FALCON24_ACCEPTANCE_EXECUTION_POLICY_INVALID");
  });

  it("requires the frozen manifest and strict policy as one startup binding", () => {
    expect(() =>
      assertFalcon24AcceptanceExecutionBinding({
        DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY: "falcon24-strict-zero-retry@1.0.0",
      }),
    ).toThrow("FALCON24_ANALYSIS_RUN_MANIFEST_REQUIRED");
    expect(() =>
      assertFalcon24AcceptanceExecutionBinding({
        FALCON24_ANALYSIS_RUN_MANIFEST: "run-manifest.json",
      }),
    ).toThrow("FALCON24_ACCEPTANCE_EXECUTION_POLICY_REQUIRED");
    expect(
      assertFalcon24AcceptanceExecutionBinding({
        DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY: "falcon24-strict-zero-retry@1.0.0",
        FALCON24_ANALYSIS_RUN_MANIFEST: "run-manifest.json",
      }),
    ).toMatchObject({ max_run_attempts: 1, suite_failure_behavior: "STOP_IMMEDIATELY" });
  });
});
