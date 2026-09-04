import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24FourLayerBusinessReceipt,
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  buildFalcon24FourLayerQaUiReceipt,
  buildFalcon24FourLayerTerminalReceipt,
  buildFalcon24FourLayerTraceUiReceipt,
  type Falcon24FourLayerGateManifest,
} from "@data-agent/contracts/evals";
import type {
  PostgresFalcon24FourLayerGateAttempt,
  PostgresFalcon24FourLayerGateTurn,
} from "@data-agent/platform/runs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadFalcon24FourLayerRecoveryPredecessor } from "../src/cli/finalize-falcon24-authority";

const id = (n: number) => `98100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const timestamp = "2026-08-30T00:00:00.000Z";
async function manifest(): Promise<Falcon24FourLayerGateManifest> {
  return buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@6.0.0",
    gate_id: "E11-FL1",
    attempt_id: id(1),
    authority_epoch: "E11",
    authority_baseline_id: id(2),
    authority_baseline_hash: hash("a"),
    authority_activation_attempt_id: id(3),
    source_commit: "1".repeat(40),
    worker_build_hash: hash("b"),
    worker_generation_hash: hash("c"),
    web_build_hash: hash("d"),
    web_generation_hash: hash("e"),
    semantic_release_hash: hash("f"),
    datasource_binding_hash: hash("1"),
    model_config_hash: hash("2"),
    runtime_attestation_hash: hash("3"),
    turns: await buildFalcon24FourLayerManifestTurns(),
  });
}

function authorityRows(document: Falcon24FourLayerGateManifest) {
  const blueprint = document.turns[0];
  if (!blueprint) throw new Error("four-layer turn fixture required");
  const attempt: PostgresFalcon24FourLayerGateAttempt = {
    app_id: id(4),
    tenant_id: id(5),
    environment: "test",
    principal_id: id(6),
    gate_id: document.gate_id,
    attempt_id: document.attempt_id,
    authority_epoch: document.authority_epoch,
    authority_baseline_id: document.authority_baseline_id,
    authority_baseline_hash: document.authority_baseline_hash,
    authority_activation_attempt_id: document.authority_activation_attempt_id,
    source_commit: document.source_commit,
    worker_build_hash: document.worker_build_hash,
    worker_generation_hash: document.worker_generation_hash,
    web_build_hash: document.web_build_hash,
    web_generation_hash: document.web_generation_hash,
    semantic_release_hash: document.semantic_release_hash,
    datasource_binding_hash: document.datasource_binding_hash,
    model_config_hash: document.model_config_hash,
    runtime_attestation_hash: document.runtime_attestation_hash,
    manifest_hash: document.manifest_hash,
    manifest_document: document,
    status: "READY",
    current_layer: "L1",
    next_turn_ordinal: 0,
    attempt_version: 1,
    first_failure_turn_ordinal: null,
    first_failure_run_id: null,
    first_failure_code: null,
    terminal_receipt_hash: null,
    terminal_receipt: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const turn: PostgresFalcon24FourLayerGateTurn = {
    app_id: attempt.app_id,
    tenant_id: attempt.tenant_id,
    environment: attempt.environment,
    principal_id: attempt.principal_id,
    attempt_id: attempt.attempt_id,
    turn_ordinal: blueprint.ordinal,
    turn_id: blueprint.turn_id,
    layer: blueprint.layer,
    scenario_id: blueprint.scenario_id,
    scenario_turn_index: blueprint.scenario_turn_index,
    conversation_group: blueprint.conversation_group,
    conversation_mode: blueprint.conversation_mode,
    question: blueprint.question,
    question_hash: blueprint.question_hash,
    expected_agents: blueprint.expected_agents,
    rubric: blueprint.rubric,
    status: "PLANNED",
    turn_version: 1,
    conversation_id: null,
    conversation_resource_version: null,
    run_id: null,
    claim_command_hash: null,
    business_receipt_hash: null,
    business_receipt: null,
    qa_ui_receipt_hash: null,
    qa_ui_receipt: null,
    trace_ui_receipt_hash: null,
    trace_ui_receipt: null,
    terminal_receipt_hash: null,
    terminal_receipt: null,
    claimed_at: null,
    completed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return { attempt, turn };
}

async function arrange(stage: "business" | "qa" | "trace" = "business") {
  const document = await manifest();
  const rows = authorityRows(document);
  const identity = {
    gate_id: document.gate_id,
    attempt_id: document.attempt_id,
    manifest_hash: document.manifest_hash,
    turn_ordinal: 0,
    turn_id: rows.turn.turn_id,
    layer: rows.turn.layer,
    scenario_id: rows.turn.scenario_id,
    scenario_turn_index: rows.turn.scenario_turn_index,
    conversation_id: id(7),
    conversation_resource_version: 1,
    run_id: id(8),
    question_hash: rows.turn.question_hash,
    worker_build_hash: document.worker_build_hash,
    worker_generation_hash: document.worker_generation_hash,
    semantic_release_hash: document.semantic_release_hash,
  };
  const failureCode = "FALCON24_TEST_FAILURE";
  const business = await buildFalcon24FourLayerBusinessReceipt({
    schema_version: "falcon24-four-layer-business-receipt@1.0.0",
    ...identity,
    answer_hash: hash("4"),
    public_event_hash: hash("5"),
    actual_profile_ids: [],
    accepted_artifact_refs: [],
    rubric_results: [
      {
        check_id: "falcon24.check.test@1",
        status: stage === "business" ? "FAIL" : "PASS",
        evidence_hash: hash("6"),
      },
    ],
    status: stage === "business" ? "FAIL" : "PASS",
    failure_code: stage === "business" ? failureCode : null,
    evaluated_at: timestamp,
  });
  const ui = {
    ...identity,
    web_build_hash: document.web_build_hash,
    web_generation_hash: document.web_generation_hash,
    dom_snapshot_hash: hash("7"),
    screenshot_hash: hash("8"),
    observed_at: timestamp,
  };
  const qa =
    stage !== "business"
      ? await buildFalcon24FourLayerQaUiReceipt({
          schema_version: "falcon24-four-layer-qa-ui-receipt@1.0.0",
          ...ui,
          answer_hash: business.answer_hash,
          composer_submission_count: 1,
          terminal_answer_visible: true,
          error_banner: null,
          status: stage === "qa" ? "FAIL" : "PASS",
          failure_code: stage === "qa" ? failureCode : null,
        })
      : null;
  const trace =
    stage === "trace"
      ? await buildFalcon24FourLayerTraceUiReceipt({
          schema_version: "falcon24-four-layer-trace-ui-receipt@1.0.0",
          ...ui,
          answer_entry_clicked: true,
          exact_run_focused: true,
          public_event_hash: business.public_event_hash,
          accepted_artifact_refs_hash: await sha256ContentHash(business.accepted_artifact_refs),
          status: "FAIL",
          failure_code: failureCode,
        })
      : null;
  const terminal = await buildFalcon24FourLayerTerminalReceipt({
    schema_version: "falcon24-four-layer-turn-terminal-receipt@1.0.0",
    ...identity,
    business_receipt_hash: business.receipt_hash,
    qa_ui_receipt_hash: qa?.receipt_hash ?? null,
    trace_ui_receipt_hash: trace?.receipt_hash ?? null,
    status: "FAILED",
    failure_code: failureCode,
    finalized_at: timestamp,
  });
  rows.attempt = {
    ...rows.attempt,
    status: "FAILED",
    first_failure_turn_ordinal: 0,
    first_failure_run_id: identity.run_id,
    first_failure_code: failureCode,
  };
  rows.turn = {
    ...rows.turn,
    status: "FAILED",
    conversation_id: identity.conversation_id,
    conversation_resource_version: 1,
    run_id: identity.run_id,
    business_receipt: business,
    business_receipt_hash: business.receipt_hash,
    qa_ui_receipt: qa,
    qa_ui_receipt_hash: qa?.receipt_hash ?? null,
    trace_ui_receipt: trace,
    trace_ui_receipt_hash: trace?.receipt_hash ?? null,
    terminal_receipt: terminal,
    terminal_receipt_hash: terminal.receipt_hash,
    completed_at: timestamp,
  };
  const gate = {
    loadAttempt: vi.fn(async () => ({ ok: true as const, value: rows.attempt })),
    loadTurn: vi.fn(async () => ({ ok: true as const, value: rows.turn })),
  };
  const input = {
    gate,
    capability: { test: true },
    scope: {
      app_id: rows.attempt.app_id,
      tenant_id: rows.attempt.tenant_id,
      environment: rows.attempt.environment,
    },
    principal_id: rows.attempt.principal_id,
    current_authority: {
      schema_version: "falcon24-authority-binding@2.0.0",
      authority_epoch: document.authority_epoch,
      baseline_id: document.authority_baseline_id,
      baseline_hash: document.authority_baseline_hash,
      activation_attempt_id: document.authority_activation_attempt_id,
    },
    predecessor_attempt_id: document.attempt_id,
  };
  return { rows, document, terminal, input };
}

describe("four-layer recovery preflight through the existing read port", () => {
  it.each(["business", "qa", "trace"] as const)(
    "reads the actual %s failure without attempt-terminal fabrication",
    async (stage) => {
      const fixture = await arrange(stage);
      await expect(loadFalcon24FourLayerRecoveryPredecessor(fixture.input)).resolves.toEqual({
        predecessor_manifest: fixture.document,
        predecessor_terminal_receipt: fixture.terminal,
      });
      expect(fixture.input.gate.loadTurn).toHaveBeenCalledWith(fixture.input.capability, {
        attempt_id: fixture.document.attempt_id,
        turn_ordinal: 0,
      });
      expect(fixture.rows.attempt.terminal_receipt).toBeNull();
    },
  );

  it("rejects wrong scope/principal/authority/first-failure or an unfinished attempt before reading turns", async () => {
    const patches: Partial<PostgresFalcon24FourLayerGateAttempt>[] = [
      { app_id: id(90) },
      { tenant_id: id(90) },
      { environment: "other" },
      { principal_id: id(90) },
      { authority_baseline_id: id(90) },
      { authority_baseline_hash: hash("9") },
      { authority_activation_attempt_id: id(90) },
      { status: "RUNNING" },
      { first_failure_turn_ordinal: null },
      { first_failure_run_id: null },
      { first_failure_code: null },
      { source_commit: "2".repeat(40) },
      { worker_build_hash: hash("9") },
    ];
    for (const patch of patches) {
      const fixture = await arrange();
      fixture.rows.attempt = { ...fixture.rows.attempt, ...patch };
      await expect(loadFalcon24FourLayerRecoveryPredecessor(fixture.input)).rejects.toThrow(
        "FALCON24_FOUR_LAYER_RECOVERY_PREFLIGHT_MISMATCH",
      );
      expect(fixture.input.gate.loadTurn).not.toHaveBeenCalled();
    }
  });

  it("rejects turn mismatch, missing terminal and substituted hashes", async () => {
    const patches: Partial<PostgresFalcon24FourLayerGateTurn>[] = [
      { principal_id: id(90) },
      { run_id: id(90) },
      { turn_ordinal: 1 },
      { conversation_id: id(90) },
      { conversation_resource_version: 2 },
      { status: "PASSED" },
      { terminal_receipt: null },
      { terminal_receipt_hash: hash("9") },
      { business_receipt_hash: hash("9") },
      { qa_ui_receipt_hash: hash("9") },
      { turn_id: "L1-02" },
    ];
    for (const patch of patches) {
      const fixture = await arrange();
      fixture.rows.turn = { ...fixture.rows.turn, ...patch };
      await expect(loadFalcon24FourLayerRecoveryPredecessor(fixture.input)).rejects.toThrow(
        "FALCON24_FOUR_LAYER_RECOVERY_PREFLIGHT_MISMATCH",
      );
    }
  });

  it("rejects a hash-valid but causally inconsistent failed stage", async () => {
    const fixture = await arrange();
    const receipt = fixture.rows.turn.business_receipt;
    if (!receipt) throw new Error("Missing business receipt");
    const { receipt_hash: _hash, ...material } = receipt;
    const business = await buildFalcon24FourLayerBusinessReceipt({
      ...material,
      status: "PASS",
      failure_code: null,
    });
    const { receipt_hash: _terminalHash, ...terminalMaterial } = fixture.terminal;
    const terminal = await buildFalcon24FourLayerTerminalReceipt({
      ...terminalMaterial,
      business_receipt_hash: business.receipt_hash,
    });
    fixture.rows.turn = {
      ...fixture.rows.turn,
      business_receipt: business,
      business_receipt_hash: business.receipt_hash,
      terminal_receipt: terminal,
      terminal_receipt_hash: terminal.receipt_hash,
    };
    await expect(loadFalcon24FourLayerRecoveryPredecessor(fixture.input)).rejects.toThrow(
      "FALCON24_FOUR_LAYER_RECOVERY_PREFLIGHT_MISMATCH",
    );
  });

  it("propagates a denied read and never proceeds to the next port", async () => {
    const fixture = await arrange();
    await expect(
      loadFalcon24FourLayerRecoveryPredecessor({
        ...fixture.input,
        gate: {
          ...fixture.input.gate,
          loadAttempt: async () => ({
            ok: false,
            error: { code: "CAPABILITY_DENIED", message: "Denied", retryable: false },
          }),
        },
      }),
    ).rejects.toThrow("CAPABILITY_DENIED");
    expect(fixture.input.gate.loadTurn).not.toHaveBeenCalled();
  });

  it("rejects hash-valid UI evidence from a different Web build or answer", async () => {
    for (const patch of [{ web_build_hash: hash("9") }, { answer_hash: hash("9") }]) {
      const fixture = await arrange("qa");
      const receipt = fixture.rows.turn.qa_ui_receipt;
      if (!receipt) throw new Error("Missing QA receipt");
      const { receipt_hash: _hash, ...material } = receipt;
      const qa = await buildFalcon24FourLayerQaUiReceipt({ ...material, ...patch });
      const { receipt_hash: _terminalHash, ...terminalMaterial } = fixture.terminal;
      const terminal = await buildFalcon24FourLayerTerminalReceipt({
        ...terminalMaterial,
        qa_ui_receipt_hash: qa.receipt_hash,
      });
      fixture.rows.turn = {
        ...fixture.rows.turn,
        qa_ui_receipt: qa,
        qa_ui_receipt_hash: qa.receipt_hash,
        terminal_receipt: terminal,
        terminal_receipt_hash: terminal.receipt_hash,
      };
      await expect(loadFalcon24FourLayerRecoveryPredecessor(fixture.input)).rejects.toThrow(
        "FALCON24_FOUR_LAYER_RECOVERY_PREFLIGHT_MISMATCH",
      );
    }
  });
});
