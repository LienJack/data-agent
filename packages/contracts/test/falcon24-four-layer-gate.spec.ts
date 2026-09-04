import { describe, expect, it } from "vitest";
import {
  buildFalcon24FourLayerAttemptTerminalReceipt,
  buildFalcon24FourLayerBusinessReceipt,
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  buildFalcon24FourLayerQaUiReceipt,
  buildFalcon24FourLayerTerminalReceipt,
  buildFalcon24FourLayerTraceUiReceipt,
  FALCON24_FOUR_LAYER_GATE_MANIFEST_VERSION,
  FALCON24_FOUR_LAYER_LAYER_TURN_COUNTS,
  FALCON24_FOUR_LAYER_LEGACY_GATE_MANIFEST_VERSION,
  FALCON24_FOUR_LAYER_TURN_BLUEPRINTS,
  FALCON24_FOUR_LAYER_V2_GATE_MANIFEST_VERSION,
  falcon24FourLayerSubmitFenceSchema,
  verifyFalcon24FourLayerAttemptTerminalReceipt,
  verifyFalcon24FourLayerConversationBindings,
  verifyFalcon24FourLayerGateManifest,
  verifyFalcon24FourLayerTurnReceiptProgression,
} from "../src/evals/falcon24-four-layer-gate.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const now = "2026-08-30T08:00:00.000Z";

async function manifest() {
  return buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@3.0.0",
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

describe("Falcon24 four-layer gate contracts", () => {
  it("defines a strict submit fence for one claimed Conversation version and Run", () => {
    const fence = {
      gate_id: "E11-FL1",
      attempt_id: id(1),
      manifest_hash: hash("a"),
      turn_ordinal: 13,
      turn_id: "L4-B-02",
      conversation_resource_version: 7,
      run_id: id(2),
    };
    expect(falcon24FourLayerSubmitFenceSchema.parse(fence)).toEqual(fence);
    expect(() =>
      falcon24FourLayerSubmitFenceSchema.parse({ ...fence, legacy_acceptance_fence: true }),
    ).toThrow();
  });

  it("freezes the 5/2/2/6 order, 15 unique questions, and two L4 conversations", async () => {
    const document = await manifest();

    expect(document.schema_version).toBe(FALCON24_FOUR_LAYER_GATE_MANIFEST_VERSION);
    expect(document.turns).toHaveLength(15);
    expect(
      Object.fromEntries(
        ["L1", "L2", "L3", "L4"].map((layer) => [
          layer,
          document.turns.filter((turn) => turn.layer === layer).length,
        ]),
      ),
    ).toEqual(FALCON24_FOUR_LAYER_LAYER_TURN_COUNTS);
    expect(new Set(document.turns.map(({ question }) => question)).size).toBe(15);
    expect(
      new Set(document.turns.map(({ question_hash: questionHash }) => questionHash)).size,
    ).toBe(15);
    expect(document.turns.map(({ turn_id: turnId }) => turnId)).toEqual(
      FALCON24_FOUR_LAYER_TURN_BLUEPRINTS.map(({ turn_id: turnId }) => turnId),
    );

    const l4 = document.turns.filter(({ layer }) => layer === "L4");
    expect(l4.map(({ conversation_group: group }) => group)).toEqual([
      "L4-A",
      "L4-A",
      "L4-A",
      "L4-B",
      "L4-B",
      "L4-B",
    ]);
    expect(l4.map(({ scenario_turn_index: index }) => index)).toEqual([0, 1, 2, 0, 1, 2]);

    await expect(verifyFalcon24FourLayerGateManifest(document)).resolves.toEqual(document);
    await expect(
      verifyFalcon24FourLayerGateManifest({
        ...document,
        turns: document.turns.map((turn, index) =>
          index === 0 ? { ...turn, question: "继续跑一次看看。" } : turn,
        ),
      }),
    ).rejects.toThrow();
  });

  it("keeps v1/v2 history verifiable while freezing the clarified v3 Text2SQL handoff", async () => {
    const current = await manifest();
    expect(current.turns[3]?.question).toContain("直接由 Text2SQL");
    expect(current.turns[6]?.question).toContain("formula.marketing_roas");
    expect(current.turns[10]?.question).toContain("只委派一个受治理 Analysis task");
    expect(current.turns[14]?.question).toContain("共32行");
    expect(current.turns[14]?.rubric.required_checks).toContain(
      "falcon24.check.complete-six-column-thirty-two-row-panel@1",
    );

    const v2Turns = await buildFalcon24FourLayerManifestTurns(
      FALCON24_FOUR_LAYER_V2_GATE_MANIFEST_VERSION,
    );
    const { manifest_hash: _manifestHash, ...material } = current;
    const v2 = await buildFalcon24FourLayerGateManifest({
      ...material,
      schema_version: FALCON24_FOUR_LAYER_V2_GATE_MANIFEST_VERSION,
      turns: v2Turns,
    });
    await expect(verifyFalcon24FourLayerGateManifest(v2)).resolves.toEqual(v2);

    const legacyTurns = await buildFalcon24FourLayerManifestTurns(
      FALCON24_FOUR_LAYER_LEGACY_GATE_MANIFEST_VERSION,
    );
    const legacy = await buildFalcon24FourLayerGateManifest({
      ...material,
      schema_version: FALCON24_FOUR_LAYER_LEGACY_GATE_MANIFEST_VERSION,
      turns: legacyTurns,
    });
    await expect(verifyFalcon24FourLayerGateManifest(legacy)).resolves.toEqual(legacy);
    await expect(
      buildFalcon24FourLayerGateManifest({
        ...material,
        schema_version: FALCON24_FOUR_LAYER_V2_GATE_MANIFEST_VERSION,
        turns: current.turns,
      }),
    ).rejects.toThrow("Falcon24 turn 与冻结题库不一致");
    await expect(
      buildFalcon24FourLayerGateManifest({
        ...material,
        schema_version: FALCON24_FOUR_LAYER_LEGACY_GATE_MANIFEST_VERSION,
        turns: current.turns,
      }),
    ).rejects.toThrow("Falcon24 turn 与冻结题库不一致");
  });

  it("freezes exact specialists for L1/L2 and bounded dynamic specialists for L3/L4", async () => {
    const document = await manifest();

    expect(document.turns.slice(0, 5).map(({ expected_agents }) => expected_agents.mode)).toEqual(
      Array(5).fill("EXACT"),
    );
    expect(document.turns[0]?.expected_agents.required_profile_ids).toEqual([
      "semantic-management-agent",
    ]);
    expect(document.turns[3]?.expected_agents.required_profile_ids).toEqual([
      "governed-text2sql-agent",
    ]);
    expect(document.turns[4]?.expected_agents.required_profile_ids).toEqual([
      "report-writing-agent",
    ]);
    expect(document.turns.slice(5, 7).map(({ expected_agents }) => expected_agents)).toEqual(
      Array(2).fill({
        mode: "EXACT",
        required_profile_ids: ["semantic-management-agent", "governed-text2sql-agent"],
        allowed_profile_ids: ["governed-text2sql-agent", "semantic-management-agent"],
        min_agent_tasks: 2,
        max_agent_tasks: 2,
      }),
    );
    expect(
      document.turns.slice(7).every(({ expected_agents }) => expected_agents.mode === "DYNAMIC"),
    ).toBe(true);
  });

  it("requires business, QA, and Trace receipts in order on the same build, attempt, Run, and conversation", async () => {
    const document = await manifest();
    const turn = document.turns[0];
    if (!turn) throw new Error("turn fixture missing");
    const common = {
      gate_id: document.gate_id,
      attempt_id: document.attempt_id,
      manifest_hash: document.manifest_hash,
      turn_ordinal: turn.ordinal,
      turn_id: turn.turn_id,
      layer: turn.layer,
      scenario_id: turn.scenario_id,
      scenario_turn_index: turn.scenario_turn_index,
      conversation_id: id(10),
      conversation_resource_version: 1,
      run_id: id(11),
      question_hash: turn.question_hash,
      worker_build_hash: document.worker_build_hash,
      worker_generation_hash: document.worker_generation_hash,
      semantic_release_hash: document.semantic_release_hash,
    } as const;
    const business = await buildFalcon24FourLayerBusinessReceipt({
      schema_version: "falcon24-four-layer-business-receipt@1.0.0",
      ...common,
      answer_hash: hash("5"),
      public_event_hash: hash("6"),
      actual_profile_ids: ["semantic-management-agent"],
      accepted_artifact_refs: [],
      rubric_results: turn.rubric.required_checks.map((checkId, index) => ({
        check_id: checkId,
        status: "PASS" as const,
        evidence_hash: hash(String((index + 5) % 10)),
      })),
      status: "PASS",
      failure_code: null,
      evaluated_at: now,
    });
    const qa = await buildFalcon24FourLayerQaUiReceipt({
      schema_version: "falcon24-four-layer-qa-ui-receipt@1.0.0",
      ...common,
      answer_hash: business.answer_hash,
      web_build_hash: document.web_build_hash,
      web_generation_hash: document.web_generation_hash,
      composer_submission_count: 1,
      terminal_answer_visible: true,
      error_banner: null,
      dom_snapshot_hash: hash("7"),
      screenshot_hash: hash("8"),
      status: "PASS",
      failure_code: null,
      observed_at: now,
    });
    const trace = await buildFalcon24FourLayerTraceUiReceipt({
      schema_version: "falcon24-four-layer-trace-ui-receipt@1.0.0",
      ...common,
      web_build_hash: document.web_build_hash,
      web_generation_hash: document.web_generation_hash,
      answer_entry_clicked: true,
      exact_run_focused: true,
      public_event_hash: business.public_event_hash,
      accepted_artifact_refs_hash: hash("9"),
      dom_snapshot_hash: hash("0"),
      screenshot_hash: hash("1"),
      status: "PASS",
      failure_code: null,
      observed_at: now,
    });
    const terminal = await buildFalcon24FourLayerTerminalReceipt({
      schema_version: "falcon24-four-layer-turn-terminal-receipt@1.0.0",
      ...common,
      business_receipt_hash: business.receipt_hash,
      qa_ui_receipt_hash: qa.receipt_hash,
      trace_ui_receipt_hash: trace.receipt_hash,
      status: "PASS",
      failure_code: null,
      finalized_at: now,
    });

    await expect(
      verifyFalcon24FourLayerTurnReceiptProgression({
        manifest: document,
        business_receipt: business,
        qa_ui_receipt: qa,
        trace_ui_receipt: trace,
        terminal_receipt: terminal,
      }),
    ).resolves.toEqual({ business, qa, trace, terminal });

    for (const [name, replacement] of [
      ["old build", { ...qa, web_build_hash: hash("a") }],
      ["cross attempt", { ...qa, attempt_id: id(99) }],
      ["cross conversation", { ...qa, conversation_id: id(98) }],
    ] as const) {
      await expect(
        verifyFalcon24FourLayerTurnReceiptProgression({
          manifest: document,
          business_receipt: business,
          qa_ui_receipt: replacement,
          trace_ui_receipt: trace,
          terminal_receipt: terminal,
        }),
        name,
      ).rejects.toThrow();
    }
  });

  it("preserves an observed Agent-contract failure without permitting a false PASS", async () => {
    const document = await manifest();
    const turn = document.turns[0];
    if (!turn) throw new Error("turn fixture missing");
    const common = {
      schema_version: "falcon24-four-layer-business-receipt@1.0.0",
      gate_id: document.gate_id,
      attempt_id: document.attempt_id,
      manifest_hash: document.manifest_hash,
      turn_ordinal: turn.ordinal,
      turn_id: turn.turn_id,
      layer: turn.layer,
      scenario_id: turn.scenario_id,
      scenario_turn_index: turn.scenario_turn_index,
      conversation_id: id(20),
      conversation_resource_version: 1,
      run_id: id(21),
      question_hash: turn.question_hash,
      worker_build_hash: document.worker_build_hash,
      worker_generation_hash: document.worker_generation_hash,
      semantic_release_hash: document.semantic_release_hash,
      answer_hash: hash("5"),
      public_event_hash: hash("6"),
      actual_profile_ids: [],
      accepted_artifact_refs: [],
      rubric_results: turn.rubric.required_checks.map((checkId) => ({
        check_id: checkId,
        status: "FAIL" as const,
        evidence_hash: hash("7"),
      })),
      evaluated_at: now,
    } as const;
    const failure = await buildFalcon24FourLayerBusinessReceipt({
      ...common,
      status: "FAIL",
      failure_code: "AGENT_CONTRACT_MISMATCH",
    });

    await expect(
      verifyFalcon24FourLayerTurnReceiptProgression({
        manifest: document,
        business_receipt: failure,
      }),
    ).resolves.toEqual({ business: failure, qa: null, trace: null, terminal: null });

    const falsePass = await buildFalcon24FourLayerBusinessReceipt({
      ...common,
      rubric_results: common.rubric_results.map((result) => ({
        ...result,
        status: "PASS" as const,
      })),
      status: "PASS",
      failure_code: null,
    });
    await expect(
      verifyFalcon24FourLayerTurnReceiptProgression({
        manifest: document,
        business_receipt: falsePass,
      }),
    ).rejects.toThrow("FALCON24_FOUR_LAYER_AGENT_CONTRACT_MISMATCH");
  });

  it("rejects cross-conversation attempt closure and hashes the exact 15-turn terminal set", async () => {
    const document = await manifest();
    const bindings = document.turns.map((turn, ordinal) => ({
      turn_ordinal: ordinal,
      turn_id: turn.turn_id,
      conversation_id: ordinal < 9 ? id(200 + ordinal) : ordinal < 12 ? id(300) : id(301),
      conversation_resource_version: ordinal < 9 ? 1 : ((ordinal - 9) % 3) + 1,
      run_id: id(400 + ordinal),
    }));

    expect(verifyFalcon24FourLayerConversationBindings(document, bindings)).toEqual(bindings);
    expect(() =>
      verifyFalcon24FourLayerConversationBindings(document, [
        ...bindings.slice(0, 10),
        { ...bindings[10], conversation_id: id(999) },
        ...bindings.slice(11),
      ]),
    ).toThrow("CONVERSATION_BINDING_INVALID");

    const receipt = await buildFalcon24FourLayerAttemptTerminalReceipt({
      schema_version: "falcon24-four-layer-attempt-terminal-receipt@1.0.0",
      gate_id: document.gate_id,
      attempt_id: document.attempt_id,
      manifest_hash: document.manifest_hash,
      worker_build_hash: document.worker_build_hash,
      worker_generation_hash: document.worker_generation_hash,
      web_build_hash: document.web_build_hash,
      web_generation_hash: document.web_generation_hash,
      semantic_release_hash: document.semantic_release_hash,
      turn_receipt_hashes: document.turns.map(
        (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`,
      ),
      status: "PASS",
      failure_code: null,
      finalized_at: now,
    });
    expect(receipt.receipt_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await expect(verifyFalcon24FourLayerAttemptTerminalReceipt(receipt)).resolves.toEqual(receipt);
  });
});
