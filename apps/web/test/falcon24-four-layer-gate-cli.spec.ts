import {
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
} from "@data-agent/contracts/evals";
import { describe, expect, it } from "vitest";
import {
  falcon24FourLayerBindingIdentity,
  falcon24FourLayerConversationMatchesDefaults,
  falcon24FourLayerProjectRepositoryRun,
  falcon24FourLayerShouldLoadRubricEvidence,
  stableFalcon24FourLayerUuid,
} from "../src/cli/falcon24-four-layer-control-identity";

const id = (suffix: number) => `98300000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function turns() {
  const manifest = await buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@4.0.0",
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
  return manifest.turns;
}

describe("Falcon24 four-layer control identities", () => {
  it("normalizes the repository COMPLETED terminal into the business-gate SUCCEEDED state", () => {
    expect(
      falcon24FourLayerProjectRepositoryRun({
        run_id: id(30),
        status: "COMPLETED",
      }),
    ).toEqual({ run_id: id(30), status: "SUCCEEDED" });
  });

  it("loads rubric evidence only for successful terminal Runs", () => {
    expect(falcon24FourLayerShouldLoadRubricEvidence("SUCCEEDED", "/tmp/rubric.json")).toBe(true);
    expect(falcon24FourLayerShouldLoadRubricEvidence("FAILED", "/tmp/rubric.json")).toBe(false);
    expect(falcon24FourLayerShouldLoadRubricEvidence("CANCELLED", "/tmp/rubric.json")).toBe(false);
    expect(falcon24FourLayerShouldLoadRubricEvidence("SUCCEEDED", undefined)).toBe(false);
  });

  it("accepts the profile-aware conversation projection returned by persistence", () => {
    const datasourceId = id(20);
    const modelProfileId = id(21);

    expect(
      falcon24FourLayerConversationMatchesDefaults({
        conversation: {
          datasource_id: datasourceId,
          model_id: modelProfileId,
          model_profile_id: modelProfileId,
        },
        defaults: {
          datasource_resource_id: datasourceId,
          model_resource_id: modelProfileId,
        },
      }),
    ).toBe(true);
    expect(
      falcon24FourLayerConversationMatchesDefaults({
        conversation: {
          datasource_id: datasourceId,
          model_id: null,
          model_profile_id: modelProfileId,
        },
        defaults: {
          datasource_resource_id: datasourceId,
          model_resource_id: modelProfileId,
        },
      }),
    ).toBe(false);
  });

  it("derives stable UUIDs while keeping every Run unique", async () => {
    const frozen = await turns();
    const bindings = frozen.map((turn) =>
      falcon24FourLayerBindingIdentity({
        workspace_id: id(4),
        principal_id: id(5),
        attempt_id: id(1),
        turn,
      }),
    );

    expect(stableFalcon24FourLayerUuid("same")).toBe(stableFalcon24FourLayerUuid("same"));
    expect(new Set(bindings.map(({ run_id: runId }) => runId)).size).toBe(15);
    expect(new Set(bindings.slice(0, 9).map(({ conversation_id }) => conversation_id)).size).toBe(
      9,
    );
    expect(new Set(bindings.slice(9, 12).map(({ conversation_id }) => conversation_id)).size).toBe(
      1,
    );
    expect(new Set(bindings.slice(12, 15).map(({ conversation_id }) => conversation_id)).size).toBe(
      1,
    );
    expect(bindings[9]?.conversation_id).not.toBe(bindings[12]?.conversation_id);
  });
});
