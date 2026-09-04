import {
  buildFalcon24FourLayerAttemptTerminalReceipt,
  buildFalcon24FourLayerBusinessReceipt,
  buildFalcon24FourLayerGateManifest,
  buildFalcon24FourLayerManifestTurns,
  buildFalcon24FourLayerQaUiReceipt,
  buildFalcon24FourLayerTerminalReceipt,
  buildFalcon24FourLayerTraceUiReceipt,
} from "@data-agent/contracts/evals";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresFalcon24FourLayerGateAuthority } from "../../src/runs/postgres-falcon24-four-layer-gate.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const now = "2026-08-30T08:00:00.000Z";
const ids = {
  app: id(1),
  tenant: id(2),
  analyst: id(3),
  deployment: id(4),
  attempt: id(5),
  baseline: id(6),
  activation: id(7),
  conversation: id(8),
  run: id(9),
};

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.analyst,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.analyst });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

async function manifest() {
  return buildFalcon24FourLayerGateManifest({
    schema_version: "falcon24-four-layer-gate-manifest@6.0.0",
    gate_id: "E11-FL1",
    attempt_id: ids.attempt,
    authority_epoch: "E11",
    authority_baseline_id: ids.baseline,
    authority_baseline_hash: hash("a"),
    authority_activation_attempt_id: ids.activation,
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

type Manifest = Awaited<ReturnType<typeof manifest>>;

function attempt(document: Manifest, overrides: Record<string, unknown> = {}) {
  return {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    principal_id: ids.analyst,
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
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function turn(document: Manifest, overrides: Record<string, unknown> = {}) {
  const frozen = document.turns[0];
  if (!frozen) throw new Error("turn fixture missing");
  return {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    principal_id: ids.analyst,
    attempt_id: ids.attempt,
    turn_ordinal: 0,
    turn_id: frozen.turn_id,
    layer: frozen.layer,
    scenario_id: frozen.scenario_id,
    scenario_turn_index: frozen.scenario_turn_index,
    conversation_group: frozen.conversation_group,
    conversation_mode: frozen.conversation_mode,
    question: frozen.question,
    question_hash: frozen.question_hash,
    expected_agents: frozen.expected_agents,
    rubric: frozen.rubric,
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
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function scriptedPool(handler: (text: string, values?: readonly unknown[]) => unknown) {
  const calls: { readonly text: string; readonly values?: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      calls.push({ text, ...(values ? { values } : {}) });
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      const value = handler(text, values);
      return {
        rows: value === undefined ? [] : [{ value }],
        rowCount: value === undefined ? 0 : 1,
      } as unknown as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

describe("PostgreSQL Falcon24 four-layer gate authority", () => {
  it("begins the exact frozen manifest through one server-owned RPC", async () => {
    const document = await manifest();
    const auth = authority();
    const scripted = scriptedPool((text) =>
      text.includes("begin_falcon24_four_layer_gate") ? { attempt: attempt(document) } : undefined,
    );
    const result = await createPostgresFalcon24FourLayerGateAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).begin(auth.capability, document);

    expect(result).toMatchObject({ ok: true, value: { attempt: { attempt_id: ids.attempt } } });
    expect(
      scripted.calls.find(({ text }) => text.includes("begin_falcon24_four_layer_gate"))?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-four-layer-gate-begin@1.0.0",
        manifest: document,
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      }),
    ]);
  });

  it("supersedes an unused READY attempt through one versioned server-owned RPC", async () => {
    const document = await manifest();
    const auth = authority();
    const superseded = attempt(document, {
      status: "FAILED",
      attempt_version: 2,
      first_failure_code: "FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED",
    });
    const scripted = scriptedPool((text) =>
      text.includes("supersede_falcon24_four_layer_gate_attempt") ? superseded : undefined,
    );
    const result = await createPostgresFalcon24FourLayerGateAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).supersedeReadyAttempt(auth.capability, {
      attempt_id: ids.attempt,
      expected_attempt_version: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "FAILED",
        first_failure_turn_ordinal: null,
        first_failure_run_id: null,
        first_failure_code: "FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED",
      },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("supersede_falcon24_four_layer_gate_attempt"))
        ?.values,
    ).toEqual([
      expect.objectContaining({
        schema_version: "falcon24-four-layer-attempt-supersede@1.0.0",
        attempt_id: ids.attempt,
        expected_attempt_version: 1,
        reason_code: "FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED",
        command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      }),
    ]);
  });

  it("claims one exact versioned turn and preserves its idempotency identity", async () => {
    const document = await manifest();
    const auth = authority();
    const response = {
      attempt: attempt(document, { status: "RUNNING", attempt_version: 2 }),
      turn: turn(document, {
        status: "CLAIMED",
        turn_version: 2,
        conversation_id: ids.conversation,
        conversation_resource_version: 3,
        run_id: ids.run,
        claim_command_hash: hash("5"),
        claimed_at: now,
      }),
    };
    const scripted = scriptedPool((text) =>
      text.includes("claim_falcon24_four_layer_gate_turn") ? response : undefined,
    );
    const result = await createPostgresFalcon24FourLayerGateAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).claimTurn(auth.capability, {
      attempt_id: ids.attempt,
      turn_ordinal: 0,
      conversation_id: ids.conversation,
      conversation_resource_version: 3,
      run_id: ids.run,
      idempotency_key: "falcon24:E11-FL1:0",
      expected_attempt_version: 1,
      expected_turn_version: 1,
    });

    expect(result).toMatchObject({ ok: true, value: { turn: { status: "CLAIMED" } } });
    expect(
      scripted.calls.find(({ text }) => text.includes("claim_falcon24_four_layer_gate_turn"))
        ?.values?.[0],
    ).toMatchObject({
      schema_version: "falcon24-four-layer-turn-claim@1.0.0",
      expected_attempt_version: 1,
      expected_turn_version: 1,
      idempotency_key: "falcon24:E11-FL1:0",
    });
  });

  it("records an observed empty Agent sequence as an immutable business failure", async () => {
    const document = await manifest();
    const frozen = document.turns[0];
    if (!frozen) throw new Error("turn fixture missing");
    const receipt = await buildFalcon24FourLayerBusinessReceipt({
      schema_version: "falcon24-four-layer-business-receipt@1.0.0",
      gate_id: document.gate_id,
      attempt_id: document.attempt_id,
      manifest_hash: document.manifest_hash,
      turn_ordinal: 0,
      turn_id: frozen.turn_id,
      layer: frozen.layer,
      scenario_id: frozen.scenario_id,
      scenario_turn_index: 0,
      conversation_id: ids.conversation,
      conversation_resource_version: 3,
      run_id: ids.run,
      question_hash: frozen.question_hash,
      worker_build_hash: document.worker_build_hash,
      worker_generation_hash: document.worker_generation_hash,
      semantic_release_hash: document.semantic_release_hash,
      answer_hash: hash("5"),
      public_event_hash: hash("6"),
      actual_profile_ids: [],
      accepted_artifact_refs: [],
      rubric_results: frozen.rubric.required_checks.map((checkId) => ({
        check_id: checkId,
        status: "FAIL" as const,
        evidence_hash: hash("7"),
      })),
      status: "FAIL",
      failure_code: "AGENT_CONTRACT_MISMATCH",
      evaluated_at: now,
    });
    const auth = authority();
    const scripted = scriptedPool((text) =>
      text.includes("record_falcon24_four_layer_business_receipt")
        ? {
            attempt: attempt(document, {
              status: "FAILED",
              attempt_version: 3,
              first_failure_turn_ordinal: 0,
              first_failure_run_id: ids.run,
              first_failure_code: receipt.failure_code,
            }),
            turn: turn(document, {
              status: "BUSINESS_FAILED",
              turn_version: 3,
              conversation_id: ids.conversation,
              conversation_resource_version: 3,
              run_id: ids.run,
              business_receipt_hash: receipt.receipt_hash,
              business_receipt: receipt,
              claimed_at: now,
            }),
          }
        : undefined,
    );
    const result = await createPostgresFalcon24FourLayerGateAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).recordBusiness(auth.capability, {
      receipt,
      expected_attempt_version: 2,
      expected_turn_version: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        attempt: { status: "FAILED", first_failure_code: "AGENT_CONTRACT_MISMATCH" },
        turn: { status: "BUSINESS_FAILED", business_receipt: { actual_profile_ids: [] } },
      },
    });
    expect(
      scripted.calls.find(({ text }) =>
        text.includes("record_falcon24_four_layer_business_receipt"),
      )?.values?.[0],
    ).toMatchObject({
      schema_version: "falcon24-four-layer-business-record@1.0.0",
      receipt: { status: "FAIL", actual_profile_ids: [] },
    });
  });

  it("records business, QA, Trace, and terminal receipts as separate commands", async () => {
    const document = await manifest();
    const frozen = document.turns[0];
    if (!frozen) throw new Error("turn fixture missing");
    const common = {
      gate_id: document.gate_id,
      attempt_id: document.attempt_id,
      manifest_hash: document.manifest_hash,
      turn_ordinal: 0,
      turn_id: frozen.turn_id,
      layer: frozen.layer,
      scenario_id: frozen.scenario_id,
      scenario_turn_index: 0,
      conversation_id: ids.conversation,
      conversation_resource_version: 3,
      run_id: ids.run,
      question_hash: frozen.question_hash,
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
      rubric_results: frozen.rubric.required_checks.map((checkId, index) => ({
        check_id: checkId,
        status: "PASS" as const,
        evidence_hash: hash(String((index + 1) % 10)),
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
    const auth = authority();
    const stagedTurn = turn(document, {
      status: "TRACE_PASSED",
      turn_version: 5,
      conversation_id: ids.conversation,
      conversation_resource_version: 3,
      run_id: ids.run,
      claim_command_hash: hash("2"),
      business_receipt_hash: business.receipt_hash,
      business_receipt: business,
      qa_ui_receipt_hash: qa.receipt_hash,
      qa_ui_receipt: qa,
      trace_ui_receipt_hash: trace.receipt_hash,
      trace_ui_receipt: trace,
      claimed_at: now,
    });
    const scripted = scriptedPool((text) => {
      if (text.includes("record_falcon24_four_layer_business_receipt")) {
        return {
          attempt: attempt(document, { status: "RUNNING", attempt_version: 3 }),
          turn: {
            ...stagedTurn,
            status: "BUSINESS_PASSED",
            turn_version: 3,
            qa_ui_receipt: null,
            qa_ui_receipt_hash: null,
            trace_ui_receipt: null,
            trace_ui_receipt_hash: null,
          },
        };
      }
      if (text.includes("record_falcon24_four_layer_qa_ui_receipt")) {
        return {
          attempt: attempt(document, { status: "RUNNING", attempt_version: 4 }),
          turn: {
            ...stagedTurn,
            status: "QA_PASSED",
            turn_version: 4,
            trace_ui_receipt: null,
            trace_ui_receipt_hash: null,
          },
        };
      }
      if (text.includes("record_falcon24_four_layer_trace_ui_receipt")) {
        return {
          attempt: attempt(document, { status: "RUNNING", attempt_version: 5 }),
          turn: stagedTurn,
        };
      }
      if (text.includes("finalize_falcon24_four_layer_gate_turn")) {
        return {
          attempt: attempt(document, {
            status: "READY",
            next_turn_ordinal: 1,
            attempt_version: 6,
          }),
          turn: {
            ...stagedTurn,
            status: "PASSED",
            turn_version: 6,
            terminal_receipt_hash: terminal.receipt_hash,
            terminal_receipt: terminal,
            completed_at: now,
          },
        };
      }
      return undefined;
    });
    const adapter = createPostgresFalcon24FourLayerGateAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(
      adapter.recordBusiness(auth.capability, {
        receipt: business,
        expected_attempt_version: 2,
        expected_turn_version: 2,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      adapter.recordQaUi(auth.capability, {
        receipt: qa,
        expected_attempt_version: 3,
        expected_turn_version: 3,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      adapter.recordTraceUi(auth.capability, {
        receipt: trace,
        expected_attempt_version: 4,
        expected_turn_version: 4,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      adapter.finalizeTurn(auth.capability, {
        receipt: terminal,
        expected_attempt_version: 5,
        expected_turn_version: 5,
      }),
    ).resolves.toMatchObject({ ok: true, value: { turn: { status: "PASSED" } } });

    expect(
      scripted.calls
        .filter(({ text }) => text.includes("four_layer"))
        .map(
          ({ values }) => (values?.[0] as { schema_version?: string } | undefined)?.schema_version,
        ),
    ).toEqual([
      "falcon24-four-layer-business-record@1.0.0",
      "falcon24-four-layer-qa-ui-record@1.0.0",
      "falcon24-four-layer-trace-ui-record@1.0.0",
      "falcon24-four-layer-turn-finalize@1.0.0",
    ]);
  });

  it("maps a concurrent expected-version rejection to one stable non-retryable error", async () => {
    const document = await manifest();
    const auth = authority();
    const scripted = scriptedPool((text) => {
      if (text.includes("claim_falcon24_four_layer_gate_turn")) {
        throw Object.assign(new Error("FALCON24_FOUR_LAYER_VERSION_CONFLICT"), { code: "40001" });
      }
      return undefined;
    });
    const result = await createPostgresFalcon24FourLayerGateAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).claimTurn(auth.capability, {
      attempt_id: document.attempt_id,
      turn_ordinal: 0,
      conversation_id: ids.conversation,
      conversation_resource_version: 3,
      run_id: ids.run,
      idempotency_key: "falcon24:E11-FL1:0",
      expected_attempt_version: 1,
      expected_turn_version: 1,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "FALCON24_FOUR_LAYER_VERSION_CONFLICT",
        message: "Falcon24 四层门禁拒绝当前操作。",
        retryable: false,
      },
    });
  });

  it("finalizes the exact attempt and validates its structured terminal receipt", async () => {
    const document = await manifest();
    const auth = authority();
    const terminalReceipt = await buildFalcon24FourLayerAttemptTerminalReceipt({
      schema_version: "falcon24-four-layer-attempt-terminal-receipt@1.0.0",
      gate_id: document.gate_id,
      attempt_id: document.attempt_id,
      manifest_hash: document.manifest_hash,
      worker_build_hash: document.worker_build_hash,
      worker_generation_hash: document.worker_generation_hash,
      web_build_hash: document.web_build_hash,
      web_generation_hash: document.web_generation_hash,
      semantic_release_hash: document.semantic_release_hash,
      turn_receipt_hashes: Array.from(
        { length: 15 },
        (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`,
      ),
      status: "PASS",
      failure_code: null,
      finalized_at: now,
    });
    const scripted = scriptedPool((text) =>
      text.includes("finalize_falcon24_four_layer_gate_attempt")
        ? attempt(document, {
            status: "PASSED",
            current_layer: "COMPLETE",
            next_turn_ordinal: 15,
            attempt_version: 77,
            terminal_receipt_hash: terminalReceipt.receipt_hash,
            terminal_receipt: terminalReceipt,
          })
        : undefined,
    );

    const result = await createPostgresFalcon24FourLayerGateAuthority({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    }).finalizeAttempt(auth.capability, {
      attempt_id: ids.attempt,
      expected_attempt_version: 76,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        attempt_id: ids.attempt,
        status: "PASSED",
        terminal_receipt: { receipt_hash: terminalReceipt.receipt_hash },
      },
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("finalize_falcon24_four_layer_gate_attempt"))
        ?.values?.[0],
    ).toMatchObject({
      schema_version: "falcon24-four-layer-attempt-finalize@1.0.0",
      attempt_id: ids.attempt,
      expected_attempt_version: 76,
      command_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
  });
});
