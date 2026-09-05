import {
  buildFalcon24FourLayerTerminalReceipt,
  type Falcon24FourLayerBusinessReceipt,
  type Falcon24FourLayerGateManifest,
  type Falcon24FourLayerQaUiReceipt,
  type Falcon24FourLayerTraceUiReceipt,
  verifyFalcon24FourLayerGateManifest,
  verifyFalcon24FourLayerTurnReceiptProgression,
} from "@data-agent/contracts/evals";
import type {
  PostgresFalcon24FourLayerGateAttempt,
  PostgresFalcon24FourLayerGateTurn,
} from "@data-agent/platform/runs";
import type { Falcon24BrowserFourLayerClaim } from "./falcon24-browser-trace-gate";

type PortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string } };

type MutationValue = Readonly<{
  attempt: PostgresFalcon24FourLayerGateAttempt;
  turn: PostgresFalcon24FourLayerGateTurn;
}>;

export interface Falcon24FourLayerAuthorityPort {
  loadAttempt(
    capability: unknown,
    input: { readonly attempt_id: string },
  ): Promise<PortResult<PostgresFalcon24FourLayerGateAttempt | null>>;
  loadTurn(
    capability: unknown,
    input: { readonly attempt_id: string; readonly turn_ordinal: number },
  ): Promise<PortResult<PostgresFalcon24FourLayerGateTurn | null>>;
  claimTurn(capability: unknown, input: unknown): Promise<PortResult<MutationValue>>;
  recordBusiness(capability: unknown, input: unknown): Promise<PortResult<MutationValue>>;
  recordQaUi(capability: unknown, input: unknown): Promise<PortResult<MutationValue>>;
  recordTraceUi(capability: unknown, input: unknown): Promise<PortResult<MutationValue>>;
  finalizeTurn(capability: unknown, input: unknown): Promise<PortResult<MutationValue>>;
}

export interface Falcon24FourLayerRunProjection {
  readonly run_id: string;
  readonly status: "QUEUED" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
}

interface ReceiptContext {
  readonly manifest: Falcon24FourLayerGateManifest;
  readonly attempt: PostgresFalcon24FourLayerGateAttempt;
  readonly turn: PostgresFalcon24FourLayerGateTurn;
  readonly run: Falcon24FourLayerRunProjection;
}

export interface Falcon24FourLayerControllerDependencies {
  readonly authority: Falcon24FourLayerAuthorityPort;
  readonly load_run: (runId: string) => Promise<Falcon24FourLayerRunProjection | null>;
  readonly submit_turn: (input: {
    readonly session: string;
    readonly claim: Falcon24BrowserFourLayerClaim;
  }) => Promise<void>;
  readonly evaluate_business: (input: ReceiptContext) => Promise<Falcon24FourLayerBusinessReceipt>;
  readonly observe_qa: (
    input: ReceiptContext & { readonly business: Falcon24FourLayerBusinessReceipt },
  ) => Promise<Falcon24FourLayerQaUiReceipt>;
  readonly observe_trace: (
    input: ReceiptContext & {
      readonly business: Falcon24FourLayerBusinessReceipt;
      readonly qa: Falcon24FourLayerQaUiReceipt;
    },
  ) => Promise<Falcon24FourLayerTraceUiReceipt>;
  readonly now?: () => Date;
}

export interface Falcon24FourLayerTurnBinding {
  readonly conversation_id: string;
  readonly conversation_resource_version: number;
  readonly run_id: string;
  readonly idempotency_key: string;
}

export type Falcon24FourLayerAdvanceResult = Readonly<
  | {
      state: "SUBMITTED" | "WAITING_RUN";
      attempt: PostgresFalcon24FourLayerGateAttempt;
      turn: PostgresFalcon24FourLayerGateTurn;
    }
  | {
      state: "TURN_TERMINAL";
      status: "PASSED" | "FAILED";
      attempt: PostgresFalcon24FourLayerGateAttempt;
      turn: PostgresFalcon24FourLayerGateTurn;
    }
>;

const ACTIVE_RUN_STATUSES = new Set<Falcon24FourLayerRunProjection["status"]>([
  "QUEUED",
  "RUNNING",
  "WAITING",
]);

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function requireAttempt(
  attempt: PostgresFalcon24FourLayerGateAttempt | null,
): PostgresFalcon24FourLayerGateAttempt {
  if (!attempt) throw new Error("FALCON24_FOUR_LAYER_NOT_FOUND");
  return attempt;
}

function requireTurn(
  turn: PostgresFalcon24FourLayerGateTurn | null,
): PostgresFalcon24FourLayerGateTurn {
  if (!turn) throw new Error("FALCON24_FOUR_LAYER_NOT_FOUND");
  return turn;
}

function assertBinding(
  turn: PostgresFalcon24FourLayerGateTurn,
  binding: Falcon24FourLayerTurnBinding,
): void {
  if (
    turn.status !== "PLANNED" &&
    (turn.conversation_id !== binding.conversation_id ||
      turn.conversation_resource_version !== binding.conversation_resource_version ||
      turn.run_id !== binding.run_id)
  ) {
    throw new Error("FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH");
  }
}

function failureCode(
  business: Falcon24FourLayerBusinessReceipt,
  qa: Falcon24FourLayerQaUiReceipt | null,
  trace: Falcon24FourLayerTraceUiReceipt | null,
): string | null {
  return trace?.failure_code ?? qa?.failure_code ?? business.failure_code;
}

async function terminalReceipt(input: {
  readonly business: Falcon24FourLayerBusinessReceipt;
  readonly qa: Falcon24FourLayerQaUiReceipt | null;
  readonly trace: Falcon24FourLayerTraceUiReceipt | null;
  readonly now: Date;
}) {
  const business = input.business;
  const passed =
    business.status === "PASS" && input.qa?.status === "PASS" && input.trace?.status === "PASS";
  return buildFalcon24FourLayerTerminalReceipt({
    schema_version: "falcon24-four-layer-turn-terminal-receipt@1.0.0",
    gate_id: business.gate_id,
    attempt_id: business.attempt_id,
    manifest_hash: business.manifest_hash,
    turn_ordinal: business.turn_ordinal,
    turn_id: business.turn_id,
    layer: business.layer,
    scenario_id: business.scenario_id,
    scenario_turn_index: business.scenario_turn_index,
    conversation_id: business.conversation_id,
    conversation_resource_version: business.conversation_resource_version,
    run_id: business.run_id,
    question_hash: business.question_hash,
    worker_build_hash: business.worker_build_hash,
    worker_generation_hash: business.worker_generation_hash,
    semantic_release_hash: business.semantic_release_hash,
    business_receipt_hash: business.receipt_hash,
    qa_ui_receipt_hash: input.qa?.receipt_hash ?? null,
    trace_ui_receipt_hash: input.trace?.receipt_hash ?? null,
    status: passed ? "PASS" : "FAILED",
    failure_code: passed ? null : (failureCode(business, input.qa, input.trace) ?? "FAILED"),
    finalized_at: input.now.toISOString(),
  });
}

export function falcon24FourLayerBrowserSession(input: {
  readonly attempt_id: string;
  readonly turn: Pick<PostgresFalcon24FourLayerGateTurn, "conversation_group" | "turn_id">;
}): string {
  return `falcon24-${input.attempt_id}`;
}

export function createFalcon24FourLayerController(
  dependencies: Falcon24FourLayerControllerDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  return Object.freeze({
    async advance(input: {
      readonly capability: unknown;
      readonly attempt_id: string;
      readonly turn_ordinal: number;
      readonly binding: Falcon24FourLayerTurnBinding;
    }): Promise<Falcon24FourLayerAdvanceResult> {
      let attempt = requireAttempt(
        value(
          await dependencies.authority.loadAttempt(input.capability, {
            attempt_id: input.attempt_id,
          }),
        ),
      );
      const manifest = await verifyFalcon24FourLayerGateManifest(attempt.manifest_document);
      let turn = requireTurn(
        value(
          await dependencies.authority.loadTurn(input.capability, {
            attempt_id: input.attempt_id,
            turn_ordinal: input.turn_ordinal,
          }),
        ),
      );
      if (
        manifest.attempt_id !== attempt.attempt_id ||
        manifest.manifest_hash !== attempt.manifest_hash ||
        turn.attempt_id !== attempt.attempt_id ||
        turn.turn_ordinal !== input.turn_ordinal
      ) {
        throw new Error("FALCON24_FOUR_LAYER_AUTHORITY_MISMATCH");
      }
      assertBinding(turn, input.binding);

      for (let phase = 0; phase < 8; phase += 1) {
        if (turn.status === "PASSED" || turn.status === "FAILED") {
          return { state: "TURN_TERMINAL", status: turn.status, attempt, turn };
        }
        if (turn.status === "PLANNED") {
          const claimed = value(
            await dependencies.authority.claimTurn(input.capability, {
              attempt_id: attempt.attempt_id,
              turn_ordinal: turn.turn_ordinal,
              conversation_id: input.binding.conversation_id,
              conversation_resource_version: input.binding.conversation_resource_version,
              run_id: input.binding.run_id,
              idempotency_key: input.binding.idempotency_key,
              expected_attempt_version: attempt.attempt_version,
              expected_turn_version: turn.turn_version,
            }),
          );
          attempt = claimed.attempt;
          turn = claimed.turn;
          continue;
        }

        const run = await dependencies.load_run(input.binding.run_id);
        if (turn.status === "CLAIMED" && run === null) {
          await dependencies.submit_turn({
            session: falcon24FourLayerBrowserSession({ attempt_id: attempt.attempt_id, turn }),
            claim: {
              schema_version: "falcon24-browser-four-layer-submit-claim@1.0.0",
              question: turn.question,
              conversation_id: input.binding.conversation_id,
              idempotency_key: input.binding.idempotency_key,
              four_layer_fence: {
                gate_id: attempt.gate_id,
                attempt_id: attempt.attempt_id,
                manifest_hash: attempt.manifest_hash,
                turn_ordinal: turn.turn_ordinal,
                turn_id: turn.turn_id,
                conversation_resource_version: input.binding.conversation_resource_version,
                run_id: input.binding.run_id,
              },
            },
          });
          return { state: "SUBMITTED", attempt, turn };
        }
        if (turn.status === "CLAIMED" && run && ACTIVE_RUN_STATUSES.has(run.status)) {
          return { state: "WAITING_RUN", attempt, turn };
        }
        if (!run || run.run_id !== turn.run_id) {
          throw new Error("FALCON24_FOUR_LAYER_RUN_MISMATCH");
        }
        const context = { manifest, attempt, turn, run };

        if (turn.status === "CLAIMED") {
          const business = await dependencies.evaluate_business(context);
          await verifyFalcon24FourLayerTurnReceiptProgression({
            manifest,
            business_receipt: business,
          });
          const recorded = value(
            await dependencies.authority.recordBusiness(input.capability, {
              receipt: business,
              expected_attempt_version: attempt.attempt_version,
              expected_turn_version: turn.turn_version,
            }),
          );
          attempt = recorded.attempt;
          turn = recorded.turn;
          continue;
        }

        const business = turn.business_receipt;
        if (!business) throw new Error("FALCON24_FOUR_LAYER_BUSINESS_RECEIPT_INVALID");
        if (turn.status === "BUSINESS_PASSED") {
          const qa = await dependencies.observe_qa({ ...context, business });
          await verifyFalcon24FourLayerTurnReceiptProgression({
            manifest,
            business_receipt: business,
            qa_ui_receipt: qa,
          });
          const recorded = value(
            await dependencies.authority.recordQaUi(input.capability, {
              receipt: qa,
              expected_attempt_version: attempt.attempt_version,
              expected_turn_version: turn.turn_version,
            }),
          );
          attempt = recorded.attempt;
          turn = recorded.turn;
          continue;
        }
        const qa = turn.qa_ui_receipt;
        if (turn.status === "QA_PASSED") {
          if (!qa) throw new Error("FALCON24_FOUR_LAYER_QA_UI_RECEIPT_INVALID");
          const trace = await dependencies.observe_trace({ ...context, business, qa });
          await verifyFalcon24FourLayerTurnReceiptProgression({
            manifest,
            business_receipt: business,
            qa_ui_receipt: qa,
            trace_ui_receipt: trace,
          });
          const recorded = value(
            await dependencies.authority.recordTraceUi(input.capability, {
              receipt: trace,
              expected_attempt_version: attempt.attempt_version,
              expected_turn_version: turn.turn_version,
            }),
          );
          attempt = recorded.attempt;
          turn = recorded.turn;
          continue;
        }
        const trace = turn.trace_ui_receipt;
        if (
          !["BUSINESS_FAILED", "QA_FAILED", "TRACE_PASSED", "TRACE_FAILED"].includes(turn.status)
        ) {
          throw new Error("FALCON24_FOUR_LAYER_ORDER_INVALID");
        }
        const terminal = await terminalReceipt({
          business,
          qa,
          trace,
          now: now(),
        });
        await verifyFalcon24FourLayerTurnReceiptProgression({
          manifest,
          business_receipt: business,
          qa_ui_receipt: qa,
          trace_ui_receipt: trace,
          terminal_receipt: terminal,
        });
        const finalized = value(
          await dependencies.authority.finalizeTurn(input.capability, {
            receipt: terminal,
            expected_attempt_version: attempt.attempt_version,
            expected_turn_version: turn.turn_version,
          }),
        );
        attempt = finalized.attempt;
        turn = finalized.turn;
      }
      throw new Error("FALCON24_FOUR_LAYER_CONTROLLER_PHASE_BUDGET_EXHAUSTED");
    },
  });
}
