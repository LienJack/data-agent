import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24FourLayerBusinessReceipt,
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  buildFalcon24FourLayerQaUiReceipt,
  buildFalcon24FourLayerTraceUiReceipt,
  type Falcon24FourLayerBusinessReceipt,
  type Falcon24FourLayerGateManifest,
  type Falcon24FourLayerQaUiReceipt,
  type Falcon24FourLayerTraceUiReceipt,
} from "@data-agent/contracts/evals";
import type {
  PostgresFalcon24FourLayerGateAttempt,
  PostgresFalcon24FourLayerGateTurn,
} from "@data-agent/platform/runs";
import { describe, expect, it, vi } from "vitest";
import {
  createFalcon24FourLayerController,
  type Falcon24FourLayerAuthorityPort,
  type Falcon24FourLayerRunProjection,
  type Falcon24FourLayerTurnBinding,
  falcon24FourLayerBrowserSession,
} from "../src/cli/falcon24-four-layer-controller";

const id = (suffix: number) => `98100000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const timestamp = "2026-08-30T00:00:00.000Z";

async function manifest(): Promise<Falcon24FourLayerGateManifest> {
  return buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@7.0.0",
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

function memoryAuthority(rows: ReturnType<typeof authorityRows>): Falcon24FourLayerAuthorityPort {
  const mutation = (
    status: PostgresFalcon24FourLayerGateTurn["status"],
    receiptKey?: "business_receipt" | "qa_ui_receipt" | "trace_ui_receipt" | "terminal_receipt",
    input?: { readonly receipt?: { readonly receipt_hash: string } },
  ) => {
    rows.attempt = {
      ...rows.attempt,
      status:
        status === "BUSINESS_FAILED" ||
        status === "QA_FAILED" ||
        status === "TRACE_FAILED" ||
        status === "FAILED"
          ? "FAILED"
          : status === "PASSED"
            ? "READY"
            : "RUNNING",
      attempt_version: rows.attempt.attempt_version + 1,
    };
    rows.turn = {
      ...rows.turn,
      status,
      turn_version: rows.turn.turn_version + 1,
      ...(receiptKey && input?.receipt
        ? {
            [receiptKey]: input.receipt,
            [`${receiptKey}_hash`]: input.receipt.receipt_hash,
          }
        : {}),
    } as PostgresFalcon24FourLayerGateTurn;
    return { ok: true as const, value: { attempt: rows.attempt, turn: rows.turn } };
  };
  return {
    loadAttempt: async () => ({ ok: true, value: rows.attempt }),
    loadTurn: async () => ({ ok: true, value: rows.turn }),
    claimTurn: async (_capability, candidate) => {
      const input = candidate as Falcon24FourLayerTurnBinding & { readonly run_id: string };
      rows.attempt = {
        ...rows.attempt,
        status: "RUNNING",
        attempt_version: rows.attempt.attempt_version + 1,
      };
      rows.turn = {
        ...rows.turn,
        status: "CLAIMED",
        turn_version: rows.turn.turn_version + 1,
        conversation_id: input.conversation_id,
        conversation_resource_version: input.conversation_resource_version,
        run_id: input.run_id,
      };
      return { ok: true, value: { attempt: rows.attempt, turn: rows.turn } };
    },
    recordBusiness: async (_capability, candidate) => {
      const input = candidate as { readonly receipt: Falcon24FourLayerBusinessReceipt };
      return mutation(
        input.receipt.status === "PASS" ? "BUSINESS_PASSED" : "BUSINESS_FAILED",
        "business_receipt",
        input,
      );
    },
    recordQaUi: async (_capability, candidate) => {
      const input = candidate as { readonly receipt: Falcon24FourLayerQaUiReceipt };
      return mutation(
        input.receipt.status === "PASS" ? "QA_PASSED" : "QA_FAILED",
        "qa_ui_receipt",
        input,
      );
    },
    recordTraceUi: async (_capability, candidate) => {
      const input = candidate as { readonly receipt: Falcon24FourLayerTraceUiReceipt };
      return mutation(
        input.receipt.status === "PASS" ? "TRACE_PASSED" : "TRACE_FAILED",
        "trace_ui_receipt",
        input,
      );
    },
    finalizeTurn: async (_capability, candidate) => {
      const input = candidate as {
        readonly receipt: { readonly status: "PASS" | "FAILED"; readonly receipt_hash: string };
      };
      return mutation(
        input.receipt.status === "PASS" ? "PASSED" : "FAILED",
        "terminal_receipt",
        input,
      );
    },
  };
}

function receiptIdentity(
  document: Falcon24FourLayerGateManifest,
  rows: ReturnType<typeof authorityRows>,
  binding: Falcon24FourLayerTurnBinding,
) {
  return {
    gate_id: document.gate_id,
    attempt_id: document.attempt_id,
    manifest_hash: document.manifest_hash,
    turn_ordinal: rows.turn.turn_ordinal,
    turn_id: rows.turn.turn_id,
    layer: rows.turn.layer,
    scenario_id: rows.turn.scenario_id,
    scenario_turn_index: rows.turn.scenario_turn_index,
    conversation_id: binding.conversation_id,
    conversation_resource_version: binding.conversation_resource_version,
    run_id: binding.run_id,
    question_hash: rows.turn.question_hash,
    worker_build_hash: document.worker_build_hash,
    worker_generation_hash: document.worker_generation_hash,
    semantic_release_hash: document.semantic_release_hash,
  } as const;
}

async function receipts(
  document: Falcon24FourLayerGateManifest,
  rows: ReturnType<typeof authorityRows>,
  binding: Falcon24FourLayerTurnBinding,
  failures: Readonly<{ business?: string; qa?: string; trace?: string }> = {},
) {
  const identity = receiptIdentity(document, rows, binding);
  const manifestTurn = document.turns.find(
    (candidate) => candidate.ordinal === rows.turn.turn_ordinal,
  );
  if (!manifestTurn) throw new Error("missing manifest turn");
  const business = await buildFalcon24FourLayerBusinessReceipt({
    schema_version: "falcon24-four-layer-business-receipt@1.0.0",
    ...identity,
    answer_hash: hash("4"),
    public_event_hash: hash("5"),
    actual_profile_ids: ["semantic-management-agent"],
    accepted_artifact_refs: [],
    rubric_results: manifestTurn.rubric.required_checks.map((checkId) => ({
      check_id: checkId,
      status: failures.business ? "FAIL" : "PASS",
      evidence_hash: hash("6"),
    })),
    status: failures.business ? "FAIL" : "PASS",
    failure_code: failures.business ?? null,
    evaluated_at: timestamp,
  });
  const qa = await buildFalcon24FourLayerQaUiReceipt({
    schema_version: "falcon24-four-layer-qa-ui-receipt@1.0.0",
    ...identity,
    answer_hash: business.answer_hash,
    web_build_hash: document.web_build_hash,
    web_generation_hash: document.web_generation_hash,
    composer_submission_count: 1,
    terminal_answer_visible: !failures.qa,
    error_banner: failures.qa ? "QA failed" : null,
    dom_snapshot_hash: hash("7"),
    screenshot_hash: hash("8"),
    status: failures.qa ? "FAIL" : "PASS",
    failure_code: failures.qa ?? null,
    observed_at: timestamp,
  });
  const trace = await buildFalcon24FourLayerTraceUiReceipt({
    schema_version: "falcon24-four-layer-trace-ui-receipt@1.0.0",
    ...identity,
    web_build_hash: document.web_build_hash,
    web_generation_hash: document.web_generation_hash,
    answer_entry_clicked: !failures.trace,
    exact_run_focused: !failures.trace,
    public_event_hash: business.public_event_hash,
    accepted_artifact_refs_hash: await sha256ContentHash([]),
    dom_snapshot_hash: hash("9"),
    screenshot_hash: hash("a"),
    status: failures.trace ? "FAIL" : "PASS",
    failure_code: failures.trace ?? null,
    observed_at: timestamp,
  });
  return { business, qa, trace };
}

const binding: Falcon24FourLayerTurnBinding = {
  conversation_id: id(10),
  conversation_resource_version: 3,
  run_id: id(11),
  idempotency_key: "four-layer-L1-01",
};

describe("Falcon24 four-layer Web controller", () => {
  it("submits once, then records business before QA and Trace for the same terminal Run", async () => {
    const document = await manifest();
    const rows = authorityRows(document);
    const authority = memoryAuthority(rows);
    const built = await receipts(document, rows, binding);
    let run: Falcon24FourLayerRunProjection | null = null;
    const calls: string[] = [];
    const submit = vi.fn(async () => {
      calls.push("submit");
    });
    const controller = createFalcon24FourLayerController({
      authority,
      load_run: async () => run,
      submit_turn: submit,
      evaluate_business: async () => {
        calls.push("business");
        return built.business;
      },
      observe_qa: async () => {
        calls.push("qa");
        return built.qa;
      },
      observe_trace: async () => {
        calls.push("trace");
        return built.trace;
      },
      now: () => new Date(timestamp),
    });

    await expect(
      controller.advance({
        capability: {},
        attempt_id: document.attempt_id,
        turn_ordinal: 0,
        binding,
      }),
    ).resolves.toMatchObject({ state: "SUBMITTED", turn: { status: "CLAIMED" } });
    run = { run_id: binding.run_id, status: "SUCCEEDED" };
    await expect(
      controller.advance({
        capability: {},
        attempt_id: document.attempt_id,
        turn_ordinal: 0,
        binding,
      }),
    ).resolves.toMatchObject({ state: "TURN_TERMINAL", status: "PASSED" });

    expect(calls).toEqual(["submit", "business", "qa", "trace"]);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("persists a business failure and skips every browser UI phase", async () => {
    const document = await manifest();
    const rows = authorityRows(document);
    const authority = memoryAuthority(rows);
    const built = await receipts(document, rows, binding, {
      business: "FALCON24_BUSINESS_RUBRIC_FAILED",
    });
    rows.attempt.status = "RUNNING";
    rows.turn = {
      ...rows.turn,
      status: "CLAIMED",
      conversation_id: binding.conversation_id,
      conversation_resource_version: binding.conversation_resource_version,
      run_id: binding.run_id,
    };
    const observeQa = vi.fn();
    const observeTrace = vi.fn();
    const controller = createFalcon24FourLayerController({
      authority,
      load_run: async () => ({ run_id: binding.run_id, status: "FAILED" }),
      submit_turn: vi.fn(),
      evaluate_business: async () => built.business,
      observe_qa: observeQa,
      observe_trace: observeTrace,
      now: () => new Date(timestamp),
    });

    await expect(
      controller.advance({
        capability: {},
        attempt_id: document.attempt_id,
        turn_ordinal: 0,
        binding,
      }),
    ).resolves.toMatchObject({ state: "TURN_TERMINAL", status: "FAILED" });
    expect(observeQa).not.toHaveBeenCalled();
    expect(observeTrace).not.toHaveBeenCalled();
  });

  it("does not submit or score while the claimed Run is still active", async () => {
    const document = await manifest();
    const rows = authorityRows(document);
    const authority = memoryAuthority(rows);
    rows.attempt.status = "RUNNING";
    rows.turn = {
      ...rows.turn,
      status: "CLAIMED",
      conversation_id: binding.conversation_id,
      conversation_resource_version: binding.conversation_resource_version,
      run_id: binding.run_id,
    };
    const submit = vi.fn();
    const evaluate = vi.fn();
    const controller = createFalcon24FourLayerController({
      authority,
      load_run: async () => ({ run_id: binding.run_id, status: "RUNNING" }),
      submit_turn: submit,
      evaluate_business: evaluate,
      observe_qa: vi.fn(),
      observe_trace: vi.fn(),
    });

    await expect(
      controller.advance({
        capability: {},
        attempt_id: document.attempt_id,
        turn_ordinal: 0,
        binding,
      }),
    ).resolves.toMatchObject({ state: "WAITING_RUN" });
    expect(submit).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("reuses one browser session for an L4 scenario and isolates independent turns", () => {
    expect(
      falcon24FourLayerBrowserSession({
        attempt_id: id(1),
        turn: { turn_id: "L4-A-01", conversation_group: "L4-A" },
      }),
    ).toBe(
      falcon24FourLayerBrowserSession({
        attempt_id: id(1),
        turn: { turn_id: "L4-A-03", conversation_group: "L4-A" },
      }),
    );
    expect(
      falcon24FourLayerBrowserSession({
        attempt_id: id(1),
        turn: { turn_id: "L1-01", conversation_group: null },
      }),
    ).not.toBe(
      falcon24FourLayerBrowserSession({
        attempt_id: id(1),
        turn: { turn_id: "L1-02", conversation_group: null },
      }),
    );
  });
});
