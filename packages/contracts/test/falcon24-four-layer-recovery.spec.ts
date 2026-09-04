import { describe, expect, it } from "vitest";
import {
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  buildFalcon24FourLayerTerminalReceipt,
} from "../src/evals/falcon24-four-layer-gate.js";
import {
  buildFalcon24ActivationRequestV8,
  falcon24RetainedActivationResultV8Schema,
  verifyFalcon24ActivationRequestV8,
  verifyFalcon24FourLayerRecoveryEvidence,
} from "../src/runs/authority-epoch.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (c: string) => `sha256:${c.repeat(64)}`;

async function fixture() {
  const manifest = await buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@8.0.0",
    gate_id: "E11-FL1",
    attempt_id: id(1),
    authority_epoch: "E11",
    authority_baseline_id: id(2),
    authority_baseline_hash: hash("1"),
    authority_activation_attempt_id: id(3),
    source_commit: "a".repeat(40),
    worker_build_hash: hash("2"),
    worker_generation_hash: hash("3"),
    web_build_hash: hash("4"),
    web_generation_hash: hash("5"),
    semantic_release_hash: hash("6"),
    datasource_binding_hash: hash("7"),
    model_config_hash: hash("8"),
    runtime_attestation_hash: hash("9"),
    turns: await buildFalcon24FourLayerManifestTurns(),
  });
  const turn = manifest.turns[0];
  if (!turn) throw new Error("Missing frozen first turn");
  const terminal = await buildFalcon24FourLayerTerminalReceipt({
    schema_version: "falcon24-four-layer-turn-terminal-receipt@1.0.0",
    gate_id: manifest.gate_id,
    attempt_id: manifest.attempt_id,
    manifest_hash: manifest.manifest_hash,
    turn_ordinal: 0,
    turn_id: turn.turn_id,
    layer: turn.layer,
    scenario_id: turn.scenario_id,
    scenario_turn_index: turn.scenario_turn_index,
    conversation_id: id(4),
    conversation_resource_version: 1,
    run_id: id(5),
    question_hash: turn.question_hash,
    worker_build_hash: manifest.worker_build_hash,
    worker_generation_hash: manifest.worker_generation_hash,
    semantic_release_hash: manifest.semantic_release_hash,
    business_receipt_hash: hash("a"),
    qa_ui_receipt_hash: null,
    trace_ui_receipt_hash: null,
    status: "FAILED",
    failure_code: "FALCON24_RUN_FAILED",
    finalized_at: "2026-08-30T03:38:32.519Z",
  });
  const request = await buildFalcon24ActivationRequestV8({
    schema_version: "falcon24-activation-request@8.0.0",
    scope: { app_id: id(6), tenant_id: id(7), environment: "test", semantic_domain: "falcon24" },
    authority_epoch: "E12",
    attempt_id: id(8),
    baseline_id: id(9),
    expected_baseline_hash: hash("b"),
    expected_current_authority: {
      schema_version: "falcon24-authority-binding@2.0.0",
      authority_epoch: manifest.authority_epoch,
      baseline_id: manifest.authority_baseline_id,
      baseline_hash: manifest.authority_baseline_hash,
      activation_attempt_id: manifest.authority_activation_attempt_id,
    },
    expected_semantic_release: {
      release_id: id(10),
      generation: 2,
      release_digest: hash("6"),
      datasource_id: id(11),
    },
    expected_versions: { semantic_pointer: 3, semantic_runtime: 3, workspace_defaults: 4 },
    retained_semantic_proof_hash: hash("c"),
    predecessor_four_layer_failure_receipt: {
      attempt_id: manifest.attempt_id,
      manifest_hash: manifest.manifest_hash,
      turn_ordinal: 0,
      run_id: terminal.run_id,
      receipt_hash: terminal.receipt_hash,
      failure_code: terminal.failure_code,
    },
    llm_execution_stage_ref: { stage_id: id(12), proof_hash: hash("d") },
  });
  return { request, manifest, terminal };
}

describe("Falcon24 retained four-layer failure recovery", () => {
  it("binds E12 to an existing FAILED turn without inventing an attempt terminal", async () => {
    const { request, manifest, terminal } = await fixture();
    await expect(verifyFalcon24ActivationRequestV8(request)).resolves.toEqual(request);
    await expect(
      verifyFalcon24FourLayerRecoveryEvidence(request, manifest, terminal),
    ).resolves.toEqual({ manifest, terminal_receipt: terminal });
    await expect(
      verifyFalcon24ActivationRequestV8({ ...request, baseline_id: id(99) }),
    ).rejects.toThrow("FALCON24_FOUR_LAYER_RECOVERY_COMMAND_HASH_INVALID");
  });

  it("rejects unknown, null, missing and legacy failure inputs", async () => {
    const { request } = await fixture();
    const { command_hash: _commandHash, ...material } = request;
    for (const key of Object.keys(request).filter((key) => key !== "command_hash")) {
      const {
        [key]: _removed,
        command_hash: _hash,
        ...without
      } = request as Record<string, unknown>;
      await expect(buildFalcon24ActivationRequestV8(without)).rejects.toThrow();
      await expect(buildFalcon24ActivationRequestV8({ ...without, [key]: null })).rejects.toThrow();
    }
    for (const key of Object.keys(request.predecessor_four_layer_failure_receipt)) {
      await expect(
        buildFalcon24ActivationRequestV8({
          ...material,
          predecessor_four_layer_failure_receipt: {
            ...request.predecessor_four_layer_failure_receipt,
            [key]: null,
          },
        }),
      ).rejects.toThrow();
    }
    await expect(
      buildFalcon24ActivationRequestV8({ ...material, predecessor_diagnostic_receipt: {} }),
    ).rejects.toThrow();
    for (const epoch of ["E11", "E13"]) {
      await expect(
        buildFalcon24ActivationRequestV8({ ...material, authority_epoch: epoch }),
      ).rejects.toThrow();
    }
    await expect(
      buildFalcon24ActivationRequestV8({
        ...material,
        authority_epoch: "E11",
        expected_current_authority: {
          ...request.expected_current_authority,
          authority_epoch: "E10",
        },
      }),
    ).rejects.toThrow("FALCON24_FOUR_LAYER_RECOVERY_EPOCH_INVALID");
    for (const patch of [
      { baseline_id: request.expected_current_authority.baseline_id },
      { attempt_id: request.expected_current_authority.activation_attempt_id },
    ]) {
      await expect(buildFalcon24ActivationRequestV8({ ...material, ...patch })).rejects.toThrow(
        "FALCON24_FOUR_LAYER_RECOVERY_ID_REUSED",
      );
    }
  });

  it("rejects hash-valid evidence from another authority or semantic release", async () => {
    const { request, manifest, terminal } = await fixture();
    for (const patch of [
      { baseline_id: id(98) },
      { baseline_hash: hash("e") },
      { activation_attempt_id: id(97) },
    ]) {
      const changed = await buildFalcon24ActivationRequestV8({
        ...request,
        expected_current_authority: { ...request.expected_current_authority, ...patch },
      });
      await expect(
        verifyFalcon24FourLayerRecoveryEvidence(changed, manifest, terminal),
      ).rejects.toThrow("FALCON24_FOUR_LAYER_RECOVERY_EVIDENCE_MISMATCH");
    }
    const changed = await buildFalcon24ActivationRequestV8({
      ...request,
      expected_semantic_release: {
        ...request.expected_semantic_release,
        release_digest: hash("e"),
      },
    });
    await expect(
      verifyFalcon24FourLayerRecoveryEvidence(changed, manifest, terminal),
    ).rejects.toThrow();
  });

  it("rejects tampered hashes and hash-valid cross-Run/build/question/PASS receipts", async () => {
    const { request, manifest, terminal } = await fixture();
    await expect(
      verifyFalcon24FourLayerRecoveryEvidence(
        request,
        { ...manifest, source_commit: "b".repeat(40) },
        terminal,
      ),
    ).rejects.toThrow("FALCON24_FOUR_LAYER_MANIFEST_HASH_INVALID");
    await expect(
      verifyFalcon24FourLayerRecoveryEvidence(request, manifest, { ...terminal, run_id: id(91) }),
    ).rejects.toThrow("FALCON24_FOUR_LAYER_RECEIPT_HASH_INVALID");
    const { receipt_hash: _hash, ...material } = terminal;
    for (const patch of [
      { run_id: id(91) },
      { attempt_id: id(92) },
      { manifest_hash: hash("e") },
      { turn_ordinal: 1 },
      { turn_id: "L1-02" },
      { layer: "L2" },
      { scenario_id: "other-scenario" },
      { scenario_turn_index: 1 },
      { question_hash: hash("e") },
      { worker_build_hash: hash("e") },
      { worker_generation_hash: hash("e") },
      { semantic_release_hash: hash("e") },
      { failure_code: "OTHER_FAILURE" },
      {
        status: "PASS",
        failure_code: null,
        qa_ui_receipt_hash: hash("e"),
        trace_ui_receipt_hash: hash("f"),
      },
    ]) {
      const changed = await buildFalcon24FourLayerTerminalReceipt({ ...material, ...patch });
      const rebound = await buildFalcon24ActivationRequestV8({
        ...request,
        predecessor_four_layer_failure_receipt: {
          ...request.predecessor_four_layer_failure_receipt,
          receipt_hash: changed.receipt_hash,
        },
      });
      await expect(
        verifyFalcon24FourLayerRecoveryEvidence(rebound, manifest, changed),
      ).rejects.toThrow("FALCON24_FOUR_LAYER_RECOVERY_EVIDENCE_MISMATCH");
    }
  });

  it("keeps the result versioned and excludes fabricated Diagnostic fields", async () => {
    const { request } = await fixture();
    const result = {
      schema_version: "falcon24-retained-activation-result@8.0.0",
      activation_command_hash: request.command_hash,
      authority: {
        schema_version: "falcon24-authority-binding@2.0.0",
        authority_epoch: "E12",
        baseline_id: id(9),
        baseline_hash: hash("b"),
        activation_attempt_id: id(8),
      },
      predecessor_four_layer_failure_receipt: request.predecessor_four_layer_failure_receipt,
      llm_execution_certification: {
        stage_id: id(12),
        proof_hash: hash("d"),
        execution_profile_hash: hash("e"),
        certification_receipt_ref: {
          artifact_type: "ModelCertificationReceipt",
          artifact_id: id(13),
          revision: 1,
          app_id: id(6),
          tenant_id: id(7),
          environment: "test",
          run_id: id(14),
          content_hash: hash("f"),
        },
      },
    };
    expect(falcon24RetainedActivationResultV8Schema.parse(result)).toEqual(result);
    expect(() =>
      falcon24RetainedActivationResultV8Schema.parse({
        ...result,
        predecessor_diagnostic_receipt: {},
      }),
    ).toThrow();
  });
});
