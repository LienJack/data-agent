import {
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
} from "@data-agent/contracts/evals";
import { describe, expect, it } from "vitest";
import {
  buildFalcon24FourLayerRubricEvidence,
  evaluateFalcon24FourLayerTurn,
  verifyFalcon24FourLayerRubricEvidence,
} from "../src/test-center/falcon24-four-layer-gate.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function manifest() {
  return buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@8.0.0",
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

  it("binds rubric evidence to the exact Run outputs and preserves an empty Agent failure", async () => {
    const document = await manifest();
    const turn = document.turns[0];
    if (!turn) throw new Error("turn fixture missing");
    const evidence = await buildFalcon24FourLayerRubricEvidence({
      schema_version: "falcon24-four-layer-rubric-evidence@1.0.0",
      gate_id: document.gate_id,
      attempt_id: document.attempt_id,
      manifest_hash: document.manifest_hash,
      turn_ordinal: turn.ordinal,
      turn_id: turn.turn_id,
      conversation_id: id(10),
      conversation_resource_version: 1,
      run_id: id(11),
      answer_hash: hash("a"),
      public_event_hash: hash("b"),
      accepted_artifact_refs_hash: hash("c"),
      accepted_input_artifact_refs_hash: hash("e"),
      observations: turn.rubric.required_checks.map((checkId) => ({
        check_id: checkId,
        status: "PASS" as const,
        evidence_hash: hash("d"),
      })),
      table_present: false,
      chart_present: false,
      accepted_input_present: false,
      current_run_evidence_present: true,
      evaluated_at: "2026-08-30T08:00:00.000Z",
    });

    await expect(verifyFalcon24FourLayerRubricEvidence(evidence)).resolves.toEqual(evidence);
    await expect(
      verifyFalcon24FourLayerRubricEvidence({ ...evidence, answer_hash: hash("e") }),
    ).rejects.toThrow("FALCON24_FOUR_LAYER_RUBRIC_EVIDENCE_HASH_INVALID");
    expect(
      evaluateFalcon24FourLayerTurn({
        turn,
        actual_profile_ids: [],
        observations: evidence.observations,
        answer_text: "采用已发布订单收入与时间口径。",
        table_present: evidence.table_present,
        chart_present: evidence.chart_present,
        accepted_input_present: evidence.accepted_input_present,
        current_run_evidence_present: evidence.current_run_evidence_present,
      }),
    ).toEqual({ status: "FAIL", failure_code: "AGENT_CONTRACT_MISMATCH" });
  });
});
