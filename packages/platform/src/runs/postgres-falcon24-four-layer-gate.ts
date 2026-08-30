import { contentHashSchema, sha256ContentHash } from "@data-agent/contracts/common";
import {
  falcon24FourLayerAttemptTerminalReceiptSchema,
  falcon24FourLayerBusinessReceiptSchema,
  falcon24FourLayerGateManifestSchema,
  falcon24FourLayerQaUiReceiptSchema,
  falcon24FourLayerTerminalReceiptSchema,
  falcon24FourLayerTraceUiReceiptSchema,
  verifyFalcon24FourLayerBusinessReceipt,
  verifyFalcon24FourLayerGateManifest,
  verifyFalcon24FourLayerQaUiReceipt,
  verifyFalcon24FourLayerTerminalReceipt,
  verifyFalcon24FourLayerTraceUiReceipt,
} from "@data-agent/contracts/evals";
import { canonicalImmutableIdSchema } from "@data-agent/contracts/workspaces";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const timestampSchema = z.iso.datetime({ offset: true });
const failureCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/u);

const attemptRowSchema = z.strictObject({
  app_id: canonicalImmutableIdSchema,
  tenant_id: canonicalImmutableIdSchema,
  environment: z.string().min(1).max(64),
  principal_id: canonicalImmutableIdSchema,
  gate_id: z.string().regex(/^E[1-9][0-9]*-FL1$/u),
  attempt_id: canonicalImmutableIdSchema,
  authority_epoch: z.string().regex(/^E[1-9][0-9]*$/u),
  authority_baseline_id: canonicalImmutableIdSchema,
  authority_baseline_hash: contentHashSchema,
  authority_activation_attempt_id: canonicalImmutableIdSchema,
  source_commit: z.string().regex(/^[0-9a-f]{40}$/u),
  worker_build_hash: contentHashSchema,
  worker_generation_hash: contentHashSchema,
  web_build_hash: contentHashSchema,
  web_generation_hash: contentHashSchema,
  semantic_release_hash: contentHashSchema,
  datasource_binding_hash: contentHashSchema,
  model_config_hash: contentHashSchema,
  runtime_attestation_hash: contentHashSchema,
  manifest_hash: contentHashSchema,
  manifest_document: falcon24FourLayerGateManifestSchema,
  status: z.enum(["READY", "RUNNING", "FINALIZING", "FAILED", "PASSED"]),
  current_layer: z.enum(["L1", "L2", "L3", "L4", "COMPLETE"]),
  next_turn_ordinal: z.number().int().min(0).max(15),
  attempt_version: z.coerce.number().int().positive().safe(),
  first_failure_turn_ordinal: z.number().int().min(0).max(14).nullable(),
  first_failure_run_id: canonicalImmutableIdSchema.nullable(),
  first_failure_code: failureCodeSchema.nullable(),
  terminal_receipt_hash: contentHashSchema.nullable(),
  terminal_receipt: falcon24FourLayerAttemptTerminalReceiptSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

const turnRowSchema = z.strictObject({
  app_id: canonicalImmutableIdSchema,
  tenant_id: canonicalImmutableIdSchema,
  environment: z.string().min(1).max(64),
  principal_id: canonicalImmutableIdSchema,
  attempt_id: canonicalImmutableIdSchema,
  turn_ordinal: z.number().int().min(0).max(14),
  turn_id: z.string().min(3).max(16),
  layer: z.enum(["L1", "L2", "L3", "L4"]),
  scenario_id: z.string().min(3).max(128),
  scenario_turn_index: z.number().int().min(0).max(2),
  conversation_group: z.enum(["L4-A", "L4-B"]).nullable(),
  conversation_mode: z.enum(["INDEPENDENT", "SHARED_SCENARIO"]),
  question: z.string().min(1).max(8_000),
  question_hash: contentHashSchema,
  expected_agents: z.json(),
  rubric: z.json(),
  status: z.enum([
    "PLANNED",
    "CLAIMED",
    "BUSINESS_PASSED",
    "BUSINESS_FAILED",
    "QA_PASSED",
    "QA_FAILED",
    "TRACE_PASSED",
    "TRACE_FAILED",
    "PASSED",
    "FAILED",
  ]),
  turn_version: z.coerce.number().int().positive().safe(),
  conversation_id: canonicalImmutableIdSchema.nullable(),
  conversation_resource_version: z.coerce.number().int().positive().safe().nullable(),
  run_id: canonicalImmutableIdSchema.nullable(),
  claim_command_hash: contentHashSchema.nullable(),
  business_receipt_hash: contentHashSchema.nullable(),
  business_receipt: falcon24FourLayerBusinessReceiptSchema.nullable(),
  qa_ui_receipt_hash: contentHashSchema.nullable(),
  qa_ui_receipt: falcon24FourLayerQaUiReceiptSchema.nullable(),
  trace_ui_receipt_hash: contentHashSchema.nullable(),
  trace_ui_receipt: falcon24FourLayerTraceUiReceiptSchema.nullable(),
  terminal_receipt_hash: contentHashSchema.nullable(),
  terminal_receipt: falcon24FourLayerTerminalReceiptSchema.nullable(),
  claimed_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

const mutationResultSchema = z.strictObject({
  attempt: attemptRowSchema,
  turn: turnRowSchema,
});
const attemptResultSchema = z.strictObject({ attempt: attemptRowSchema });
const versionSchema = z.number().int().positive().safe();
const claimInputSchema = z.strictObject({
  attempt_id: canonicalImmutableIdSchema,
  turn_ordinal: z.number().int().min(0).max(14),
  conversation_id: canonicalImmutableIdSchema,
  conversation_resource_version: versionSchema,
  run_id: canonicalImmutableIdSchema,
  idempotency_key: z.string().min(1).max(256),
  expected_attempt_version: versionSchema,
  expected_turn_version: versionSchema,
});
const recordInputSchema = z.strictObject({
  receipt: z.unknown(),
  expected_attempt_version: versionSchema,
  expected_turn_version: versionSchema,
});
const finalizeAttemptInputSchema = z.strictObject({
  attempt_id: canonicalImmutableIdSchema,
  expected_attempt_version: versionSchema,
});

type JsonRow = { readonly value: unknown };

const STABLE_DATABASE_ERRORS = new Set([
  "FALCON24_FOUR_LAYER_COMMAND_INVALID",
  "FALCON24_FOUR_LAYER_MANIFEST_INVALID",
  "FALCON24_FOUR_LAYER_AUTHORITY_MISMATCH",
  "FALCON24_FOUR_LAYER_ACTIVE_ATTEMPT_EXISTS",
  "FALCON24_FOUR_LAYER_NOT_FOUND",
  "FALCON24_FOUR_LAYER_REPLAY_MISMATCH",
  "FALCON24_FOUR_LAYER_VERSION_CONFLICT",
  "FALCON24_FOUR_LAYER_ORDER_INVALID",
  "FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH",
  "FALCON24_FOUR_LAYER_BUSINESS_RECEIPT_INVALID",
  "FALCON24_FOUR_LAYER_QA_UI_RECEIPT_INVALID",
  "FALCON24_FOUR_LAYER_TRACE_UI_RECEIPT_INVALID",
  "FALCON24_FOUR_LAYER_TERMINAL_RECEIPT_INVALID",
  "FALCON24_FOUR_LAYER_BUILD_MISMATCH",
  "FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH",
  "FALCON24_FOUR_LAYER_RUN_MISMATCH",
  "FALCON24_FOUR_LAYER_AGENT_CONTRACT_MISMATCH",
  "FALCON24_FOUR_LAYER_RUBRIC_CLOSURE_INVALID",
  "FALCON24_FOUR_LAYER_UI_AFTER_BUSINESS_FAILURE",
  "FALCON24_FOUR_LAYER_TRACE_BEFORE_QA_PASS",
  "FALCON24_FOUR_LAYER_TERMINAL_CLOSURE_INVALID",
  "FALCON24_FOUR_LAYER_ATTEMPT_FINALIZATION_INVALID",
  "FALCON24_FOUR_LAYER_SUPERSEDE_INVALID",
]);

function mapDatabaseError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? (error as { readonly message?: unknown }).message
      : null;
  if (typeof message !== "string" || !STABLE_DATABASE_ERRORS.has(message)) return null;
  return {
    ok: false as const,
    error: { code: message, message: "Falcon24 四层门禁拒绝当前操作。", retryable: false },
  };
}

function exact(rows: readonly JsonRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "FALCON24_FOUR_LAYER_DATABASE_CONTRACT_INVALID",
      "Falcon24 four-layer RPC 必须返回恰好一行。",
    );
  }
  return rows[0]?.value;
}

async function commandWithHash<T extends Record<string, unknown>>(command: T) {
  return { ...command, command_hash: await sha256ContentHash(command) } as const;
}

function assertAttemptIdentity<T extends z.infer<typeof attemptRowSchema>>(
  attempt: T,
  expectedAttemptId: string,
): T {
  if (attempt.attempt_id !== expectedAttemptId) {
    throw new PersistenceBoundaryError(
      "FALCON24_FOUR_LAYER_DATABASE_CONTRACT_INVALID",
      "Falcon24 four-layer RPC 返回了不同的 Attempt。",
    );
  }
  return attempt;
}

function assertMutationIdentity(
  result: z.infer<typeof mutationResultSchema>,
  expected: { readonly attempt_id: string; readonly turn_ordinal: number },
) {
  if (
    result.attempt.attempt_id !== expected.attempt_id ||
    result.turn.attempt_id !== expected.attempt_id ||
    result.turn.turn_ordinal !== expected.turn_ordinal
  ) {
    throw new PersistenceBoundaryError(
      "FALCON24_FOUR_LAYER_DATABASE_CONTRACT_INVALID",
      "Falcon24 four-layer RPC 返回了不同的 Turn。",
    );
  }
  return result;
}

function assertTurnIdentity<T extends z.infer<typeof turnRowSchema>>(
  turn: T,
  expected: { readonly attempt_id: string; readonly turn_ordinal: number },
): T {
  if (turn.attempt_id !== expected.attempt_id || turn.turn_ordinal !== expected.turn_ordinal) {
    throw new PersistenceBoundaryError(
      "FALCON24_FOUR_LAYER_DATABASE_CONTRACT_INVALID",
      "Falcon24 four-layer RPC 返回了不同的 Turn。",
    );
  }
  return turn;
}

export function createPostgresFalcon24FourLayerGateAuthority(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  async function mutation(
    capabilityInput: unknown,
    operationName: string,
    rpcName: string,
    command: Record<string, unknown>,
    expected: { readonly attempt_id: string; readonly turn_ordinal: number },
  ) {
    return withAppTransaction(
      input.pool,
      input.authorizer,
      capabilityInput,
      {
        access: "WRITE",
        allowed_roles: ["OWNER", "ANALYST"],
        operation_name: operationName,
        map_database_error: mapDatabaseError,
      },
      async ({ client }) => {
        const result = await client.query<JsonRow>(
          `select app_data_agent.${rpcName}($1::jsonb) as value`,
          [await commandWithHash(command)],
        );
        return assertMutationIdentity(mutationResultSchema.parse(exact(result.rows)), expected);
      },
    );
  }

  return Object.freeze({
    async loadAttempt(capabilityInput: unknown, candidate: { readonly attempt_id: unknown }) {
      const request = z.strictObject({ attempt_id: canonicalImmutableIdSchema }).parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-four-layer-attempt-load@1.0.0" as const,
        attempt_id: request.attempt_id,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-four-layer.load-attempt",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_four_layer_gate_attempt($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          return raw === null
            ? null
            : assertAttemptIdentity(attemptRowSchema.parse(raw), request.attempt_id);
        },
      );
    },

    async loadTurn(capabilityInput: unknown, candidate: unknown) {
      const request = z
        .strictObject({
          attempt_id: canonicalImmutableIdSchema,
          turn_ordinal: z.number().int().min(0).max(14),
        })
        .parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-four-layer-turn-load@1.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-four-layer.load-turn",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_four_layer_gate_turn($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          return assertTurnIdentity(turnRowSchema.parse(raw), request);
        },
      );
    },

    async begin(capabilityInput: unknown, manifestInput: unknown) {
      const manifest = await verifyFalcon24FourLayerGateManifest(manifestInput);
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-four-layer.begin",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const command = await commandWithHash({
            schema_version: "falcon24-four-layer-gate-begin@1.0.0" as const,
            manifest,
          });
          const result = await client.query<JsonRow>(
            "select app_data_agent.begin_falcon24_four_layer_gate($1::jsonb) as value",
            [command],
          );
          const resultDocument = attemptResultSchema.parse(exact(result.rows));
          return {
            attempt: assertAttemptIdentity(resultDocument.attempt, manifest.attempt_id),
          };
        },
      );
    },

    async supersedeReadyAttempt(capabilityInput: unknown, candidate: unknown) {
      const request = finalizeAttemptInputSchema.parse(candidate);
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-four-layer.supersede-ready-attempt",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const command = await commandWithHash({
            schema_version: "falcon24-four-layer-attempt-supersede@1.0.0" as const,
            ...request,
            reason_code: "FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED" as const,
          });
          const result = await client.query<JsonRow>(
            "select app_data_agent.supersede_falcon24_four_layer_gate_attempt($1::jsonb) as value",
            [command],
          );
          return assertAttemptIdentity(
            attemptRowSchema.parse(exact(result.rows)),
            request.attempt_id,
          );
        },
      );
    },

    async claimTurn(capabilityInput: unknown, candidate: unknown) {
      const request = claimInputSchema.parse(candidate);
      return mutation(
        capabilityInput,
        "falcon24-four-layer.claim-turn",
        "claim_falcon24_four_layer_gate_turn",
        { schema_version: "falcon24-four-layer-turn-claim@1.0.0", ...request },
        request,
      );
    },

    async recordBusiness(capabilityInput: unknown, candidate: unknown) {
      const request = recordInputSchema.parse(candidate);
      const receipt = await verifyFalcon24FourLayerBusinessReceipt(request.receipt);
      return mutation(
        capabilityInput,
        "falcon24-four-layer.record-business",
        "record_falcon24_four_layer_business_receipt",
        {
          schema_version: "falcon24-four-layer-business-record@1.0.0",
          receipt,
          expected_attempt_version: request.expected_attempt_version,
          expected_turn_version: request.expected_turn_version,
        },
        { attempt_id: receipt.attempt_id, turn_ordinal: receipt.turn_ordinal },
      );
    },

    async recordQaUi(capabilityInput: unknown, candidate: unknown) {
      const request = recordInputSchema.parse(candidate);
      const receipt = await verifyFalcon24FourLayerQaUiReceipt(request.receipt);
      return mutation(
        capabilityInput,
        "falcon24-four-layer.record-qa-ui",
        "record_falcon24_four_layer_qa_ui_receipt",
        {
          schema_version: "falcon24-four-layer-qa-ui-record@1.0.0",
          receipt,
          expected_attempt_version: request.expected_attempt_version,
          expected_turn_version: request.expected_turn_version,
        },
        { attempt_id: receipt.attempt_id, turn_ordinal: receipt.turn_ordinal },
      );
    },

    async recordTraceUi(capabilityInput: unknown, candidate: unknown) {
      const request = recordInputSchema.parse(candidate);
      const receipt = await verifyFalcon24FourLayerTraceUiReceipt(request.receipt);
      return mutation(
        capabilityInput,
        "falcon24-four-layer.record-trace-ui",
        "record_falcon24_four_layer_trace_ui_receipt",
        {
          schema_version: "falcon24-four-layer-trace-ui-record@1.0.0",
          receipt,
          expected_attempt_version: request.expected_attempt_version,
          expected_turn_version: request.expected_turn_version,
        },
        { attempt_id: receipt.attempt_id, turn_ordinal: receipt.turn_ordinal },
      );
    },

    async finalizeTurn(capabilityInput: unknown, candidate: unknown) {
      const request = recordInputSchema.parse(candidate);
      const receipt = await verifyFalcon24FourLayerTerminalReceipt(request.receipt);
      return mutation(
        capabilityInput,
        "falcon24-four-layer.finalize-turn",
        "finalize_falcon24_four_layer_gate_turn",
        {
          schema_version: "falcon24-four-layer-turn-finalize@1.0.0",
          receipt,
          expected_attempt_version: request.expected_attempt_version,
          expected_turn_version: request.expected_turn_version,
        },
        { attempt_id: receipt.attempt_id, turn_ordinal: receipt.turn_ordinal },
      );
    },

    async finalizeAttempt(capabilityInput: unknown, candidate: unknown) {
      const request = finalizeAttemptInputSchema.parse(candidate);
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-four-layer.finalize-attempt",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const command = await commandWithHash({
            schema_version: "falcon24-four-layer-attempt-finalize@1.0.0" as const,
            ...request,
          });
          const result = await client.query<JsonRow>(
            "select app_data_agent.finalize_falcon24_four_layer_gate_attempt($1::jsonb) as value",
            [command],
          );
          return assertAttemptIdentity(
            attemptRowSchema.parse(exact(result.rows)),
            request.attempt_id,
          );
        },
      );
    },
  });
}

export type PostgresFalcon24FourLayerGateAttempt = z.infer<typeof attemptRowSchema>;
export type PostgresFalcon24FourLayerGateTurn = z.infer<typeof turnRowSchema>;
