import {
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
} from "@data-agent/contracts/evals";
import { describe, expect, it } from "vitest";
import { evaluateFalcon24FourLayerTurn } from "../src/test-center/falcon24-four-layer-gate.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function manifest() {
  return buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@1.0.0",
    gate_id: "E11-FL1",
    attempt_id: id(1),
    authority_epoch: "E11",
    authority_baseline_id: id(2),
    authority_baseline_hash: hash("a"),
    authority_activation_attempt_id: id(3),
    source_commit: "b".repeat(40),
    worker_build_hash: hash("c"),
    worker_generation_hash: hash("d"),
    web_build_hash: hash("e"),
    web_generation_hash: hash("f"),
    semantic_release_hash: hash("1"),
    datasource_binding_hash: hash("2"),
    model_config_hash: hash("3"),
    runtime_attestation_hash: hash("4"),
    turns: await buildFalcon24FourLayerManifestTurns(),
  });
}

describe("Falcon24 four-layer deterministic evaluator", () => {
  it("passes only when the observed exact Agent sequence and rubric closure match", async () => {
    const document = await manifest();
    const turn = document.turns[5];
    if (!turn) throw new Error("turn fixture missing");
    const observations = turn.rubric.required_checks.map((checkId, index) => ({
      check_id: checkId,
      status: "PASS" as const,
      evidence_hash: hash(String(index % 10)),
    }));

    expect(
      evaluateFalcon24FourLayerTurn({
        turn,
        actual_profile_ids: ["semantic-management-agent", "governed-text2sql-agent"],
        observations,
        answer_text: "采用已发布收入与完整月时间口径，结果见表格。",
        table_present: true,
        chart_present: false,
        accepted_input_present: false,
        current_run_evidence_present: true,
      }),
    ).toMatchObject({ status: "PASS", failure_code: null });

    expect(
      evaluateFalcon24FourLayerTurn({
        turn,
        actual_profile_ids: ["governed-text2sql-agent", "semantic-management-agent"],
        observations,
        answer_text: "结果见表格。",
        table_present: true,
        chart_present: false,
        accepted_input_present: false,
        current_run_evidence_present: true,
      }),
    ).toMatchObject({ status: "FAIL", failure_code: "AGENT_CONTRACT_MISMATCH" });
  });

  it("allows dynamic routing only inside the frozen bounds and rejects missing rubric evidence", async () => {
    const document = await manifest();
    const turn = document.turns[7];
    if (!turn) throw new Error("turn fixture missing");
    const observations = turn.rubric.required_checks.map((checkId, index) => ({
      check_id: checkId,
      status: "PASS" as const,
      evidence_hash: hash(String(index % 10)),
    }));
    const base = {
      turn,
      actual_profile_ids: [
        "semantic-management-agent",
        "governed-text2sql-agent",
        "governed-analysis-agent",
        "report-writing-agent",
      ],
      observations,
      answer_text: "趋势强度与经营结论基于当前 Run 证据，见折线图。",
      table_present: true,
      chart_present: true,
      accepted_input_present: false,
      current_run_evidence_present: true,
    } as const;

    expect(evaluateFalcon24FourLayerTurn(base)).toMatchObject({
      status: "PASS",
      failure_code: null,
    });
    expect(
      evaluateFalcon24FourLayerTurn({ ...base, observations: observations.slice(1) }),
    ).toMatchObject({ status: "FAIL", failure_code: "RUBRIC_EVIDENCE_INCOMPLETE" });
    expect(
      evaluateFalcon24FourLayerTurn({
        ...base,
        actual_profile_ids: [...base.actual_profile_ids, "unpublished-specialist-agent"],
      }),
    ).toMatchObject({ status: "FAIL", failure_code: "AGENT_CONTRACT_MISMATCH" });
  });
});
