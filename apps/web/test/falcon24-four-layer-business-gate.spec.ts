import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  type Falcon24FourLayerGateManifest,
} from "@data-agent/contracts/evals";
import { buildFalcon24FourLayerRubricEvidence } from "@data-agent/evals";
import type { PostgresFalcon24FourLayerGateTurn } from "@data-agent/platform/runs";
import { describe, expect, it } from "vitest";
import {
  evaluateFalcon24FourLayerBusiness,
  projectFalcon24FourLayerBusinessRun,
} from "../src/cli/falcon24-four-layer-business-gate";

const id = (suffix: number) => `98200000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const timestamp = "2026-08-30T00:00:00.000Z";
const runId = id(20);
const conversationId = id(21);
const taskId = id(22);

async function manifest(): Promise<Falcon24FourLayerGateManifest> {
  return buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@5.0.0",
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

function claimedTurn(document: Falcon24FourLayerGateManifest): PostgresFalcon24FourLayerGateTurn {
  const blueprint = document.turns[0];
  if (!blueprint) throw new Error("turn fixture missing");
  return {
    app_id: id(4),
    tenant_id: id(5),
    environment: "test",
    principal_id: id(6),
    attempt_id: document.attempt_id,
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
    status: "CLAIMED",
    turn_version: 2,
    conversation_id: conversationId,
    conversation_resource_version: 1,
    run_id: runId,
    claim_command_hash: hash("4"),
    business_receipt_hash: null,
    business_receipt: null,
    qa_ui_receipt_hash: null,
    qa_ui_receipt: null,
    trace_ui_receipt_hash: null,
    trace_ui_receipt: null,
    terminal_receipt_hash: null,
    terminal_receipt: null,
    claimed_at: timestamp,
    completed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

const reference = {
  app_id: id(4),
  tenant_id: id(5),
  environment: "test",
  artifact_id: id(30),
  artifact_type: "SemanticQueryContext",
  run_id: runId,
  revision: 1,
  content_hash: hash("5"),
} as const;

function event(sequence: number, type: string, payload: unknown) {
  return {
    schema_version: "public-run-event@2.0.0",
    event_id: id(100 + sequence),
    run_id: runId,
    sequence,
    occurred_at: `2026-08-30T00:00:0${sequence}.000Z`,
    type,
    payload,
  };
}

function completedEvents(options: { readonly includeSpecialist?: boolean } = {}) {
  const identity = { profile_id: "semantic-management-agent", task_id: taskId } as const;
  return [
    event(1, "agent", {
      profile_id: "data-agent-orchestrator",
      task_id: id(23),
      status: "COMPLETED",
      phase: "root.turn",
      title: "Root",
      summary: "Root completed",
      duration_ms: 12,
      error_code: null,
    }),
    ...(options.includeSpecialist === false
      ? []
      : [
          event(2, "agent", {
            ...identity,
            status: "COMPLETED",
            phase: "semantic.resolve",
            title: "Semantic",
            summary: "Semantic completed",
            duration_ms: 10,
            error_code: null,
          }),
        ]),
    event(3, "tool", {
      call_id: "semantic-call",
      tool_name: "semantic.resolve@1.0.0",
      title: "Resolve semantic context",
      summary: "Resolving",
      status: "RUNNING",
      input: null,
      output: null,
      duration_ms: null,
      error_code: null,
      ...identity,
      artifact_refs: [],
    }),
    event(4, "tool", {
      call_id: "semantic-call",
      tool_name: "semantic.resolve@1.0.0",
      title: "Resolve semantic context",
      summary: "Resolved",
      status: "COMPLETED",
      input: null,
      output: null,
      duration_ms: 8,
      error_code: null,
      ...identity,
      artifact_refs: [reference],
    }),
    event(5, "answer", { delta: "采用已发布订单收入与时间口径，并按完整月计算同比。" }),
    event(6, "terminal", { status: "COMPLETED", summary: "Done", error_code: null }),
  ];
}

async function evidenceFor(
  document: Falcon24FourLayerGateManifest,
  turn: PostgresFalcon24FourLayerGateTurn,
  events: readonly unknown[],
) {
  const observation = await projectFalcon24FourLayerBusinessRun({
    run: { run_id: runId, status: "SUCCEEDED" },
    public_events: events,
  });
  const blueprint = document.turns[0];
  if (!blueprint) throw new Error("turn fixture missing");
  return buildFalcon24FourLayerRubricEvidence({
    schema_version: "falcon24-four-layer-rubric-evidence@1.0.0",
    gate_id: document.gate_id,
    attempt_id: document.attempt_id,
    manifest_hash: document.manifest_hash,
    turn_ordinal: turn.turn_ordinal,
    turn_id: turn.turn_id,
    conversation_id: conversationId,
    conversation_resource_version: 1,
    run_id: runId,
    answer_hash: observation.answer_hash,
    public_event_hash: observation.public_event_hash,
    accepted_artifact_refs_hash: observation.accepted_artifact_refs_hash,
    accepted_input_artifact_refs_hash: await sha256ContentHash([]),
    observations: blueprint.rubric.required_checks.map((checkId) => ({
      check_id: checkId,
      status: "PASS" as const,
      evidence_hash: hash("6"),
    })),
    table_present: false,
    chart_present: false,
    accepted_input_present: false,
    current_run_evidence_present: true,
    evaluated_at: timestamp,
  });
}

describe("Falcon24 four-layer business gate", () => {
  it("binds a PASS receipt to the exact public event, answer, Agent, and Artifact closure", async () => {
    const document = await manifest();
    const turn = claimedTurn(document);
    const events = completedEvents();
    const evidence = await evidenceFor(document, turn, events);
    const receipt = await evaluateFalcon24FourLayerBusiness({
      manifest: document,
      turn,
      run: { run_id: runId, status: "SUCCEEDED" },
      public_events: events,
      rubric_evidence: evidence,
      now: () => new Date(timestamp),
    });

    expect(receipt).toMatchObject({
      status: "PASS",
      failure_code: null,
      answer_hash: evidence.answer_hash,
      public_event_hash: evidence.public_event_hash,
      actual_profile_ids: ["semantic-management-agent"],
      accepted_artifact_refs: [reference],
    });
  });

  it("persists an observed missing Specialist as FAIL without opening UI evidence", async () => {
    const document = await manifest();
    const turn = claimedTurn(document);
    const events = completedEvents({ includeSpecialist: false });
    const evidence = await evidenceFor(document, turn, events);
    const receipt = await evaluateFalcon24FourLayerBusiness({
      manifest: document,
      turn,
      run: { run_id: runId, status: "SUCCEEDED" },
      public_events: events,
      rubric_evidence: evidence,
      now: () => new Date(timestamp),
    });

    expect(receipt).toMatchObject({
      status: "FAIL",
      failure_code: "AGENT_CONTRACT_MISMATCH",
      actual_profile_ids: [],
    });
  });

  it("rejects cross-output evaluator evidence and closes a failed Run without it", async () => {
    const document = await manifest();
    const turn = claimedTurn(document);
    const events = completedEvents();
    const observation = await projectFalcon24FourLayerBusinessRun({
      run: { run_id: runId, status: "SUCCEEDED" },
      public_events: events,
    });
    const { evidence_hash: _evidenceHash, ...evidenceMaterial } = await evidenceFor(
      document,
      turn,
      events,
    );
    const mismatched = await buildFalcon24FourLayerRubricEvidence({
      ...evidenceMaterial,
      answer_hash: await sha256ContentHash("another answer"),
    });
    await expect(
      evaluateFalcon24FourLayerBusiness({
        manifest: document,
        turn,
        run: { run_id: runId, status: "SUCCEEDED" },
        public_events: events,
        rubric_evidence: mismatched,
      }),
    ).rejects.toThrow("FALCON24_FOUR_LAYER_RUBRIC_EVIDENCE_IDENTITY_MISMATCH");
    expect(observation.answer_hash).not.toBe(mismatched.answer_hash);

    const failedEvents = [
      event(1, "terminal", {
        status: "FAILED",
        summary: "Failed",
        error_code: "TEAM_RUNTIME_FAILED",
      }),
    ];
    const failedReceipt = await evaluateFalcon24FourLayerBusiness({
      manifest: document,
      turn,
      run: { run_id: runId, status: "FAILED" },
      public_events: failedEvents,
      now: () => new Date(timestamp),
    });
    expect(failedReceipt).toMatchObject({
      status: "FAIL",
      failure_code: "FALCON24_RUN_FAILED",
      actual_profile_ids: [],
    });
    expect(failedReceipt.rubric_results.every(({ status }) => status === "FAIL")).toBe(true);
  });
});
