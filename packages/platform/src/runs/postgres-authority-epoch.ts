import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  falcon24AuthorityBaselineV2Schema,
  verifyFalcon24AuthorityBaselineDocument,
} from "@data-agent/contracts/evals";
import {
  falcon24ActivationAttemptDocumentSchema,
  falcon24ActivationAttemptRequestV2Schema,
  falcon24ActivationHoldRequestV2Schema,
  falcon24ActivationRequestV2Schema,
  falcon24AuthorityBindingSchema,
  falcon24AuthorityBindingV2Schema,
  falcon24RunAuthorityLookupSchema,
  falcon24StageBaselineRequestV2Schema,
  falcon24StagingSessionRequestV2Schema,
  falcon24UiReceiptDocumentSchema,
  falcon24UiReceiptV2Schema,
  verifyFalcon24StagingReceiptV2,
  verifyFalcon24UiReceiptDocument,
} from "@data-agent/contracts/runs";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const stagingSessionSchema = z.strictObject({
  schema_version: z.literal("falcon24-staging-session@2.0.0"),
  authority_epoch: falcon24StagingSessionRequestV2Schema.shape.authority_epoch,
  staging_id: z.uuid(),
  retained_assets_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  status: z.enum(["STAGED", "HOLD", "CONSUMED"]),
});

const STABLE_DATABASE_ERRORS = new Set([
  "FALCON24_AUTHORITY_STAGING_SESSION_INVALID",
  "FALCON24_AUTHORITY_STAGING_IDENTITY_CONFLICT",
  "FALCON24_AUTHORITY_STAGING_SESSION_NOT_FOUND",
  "FALCON24_AUTHORITY_STAGING_SESSION_TERMINAL",
  "FALCON24_AUTHORITY_STAGING_RECEIPT_INVALID",
  "FALCON24_AUTHORITY_STAGING_RECEIPT_CONFLICT",
  "FALCON24_AUTHORITY_STAGING_INCOMPLETE",
  "FALCON24_AUTHORITY_BASELINE_INVALID",
  "FALCON24_AUTHORITY_BASELINE_NOT_FOUND",
  "FALCON24_AUTHORITY_BASELINE_NOT_STAGED",
  "FALCON24_AUTHORITY_BASELINE_IDENTITY_CONFLICT",
  "FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_INVALID",
  "FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_NOT_FOUND",
  "FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_MISMATCH",
  "FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_CONFLICT",
  "FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_TERMINAL",
  "FALCON24_AUTHORITY_ACTIVATION_HOLD_INVALID",
  "FALCON24_AUTHORITY_ACTIVATION_HOLD_CONFLICT",
  "FALCON24_AUTHORITY_ACTIVATION_INVALID",
  "FALCON24_AUTHORITY_ACTIVATION_PREFLIGHT_FAILED",
  "FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR",
  "FALCON24_CURRENT_AUTHORITY_NOT_FOUND",
  "FALCON24_AUTHORITY_NOT_ACTIVE",
  "FALCON24_RUN_AUTHORITY_LOAD_INVALID",
  "FALCON24_RUN_NOT_FOUND",
  "FALCON24_UI_RECEIPT_COMMAND_INVALID",
  "FALCON24_UI_RECEIPT_INVALID",
  "FALCON24_QA_E2E_RECEIPT_INVALID",
  "FALCON24_TRACE_UI_RECEIPT_INVALID",
  "FALCON24_UI_RECEIPT_RUN_NOT_READY",
  "FALCON24_UI_RECEIPT_AUTHORITY_MISMATCH",
  "FALCON24_UI_RECEIPT_ARTIFACT_MISMATCH",
  "FALCON24_UI_RECEIPT_REPLAY_MISMATCH",
  "FALCON24_UI_RECEIPT_LOAD_INVALID",
]);

type JsonRow = { readonly value: unknown };

function mapDatabaseError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? (error as { readonly message?: unknown }).message
      : null;
  if (typeof message !== "string" || !STABLE_DATABASE_ERRORS.has(message)) return null;
  return {
    ok: false as const,
    error: {
      code: message,
      message: "Falcon24 PostgreSQL Authority 拒绝当前操作。",
      retryable: false,
    },
  };
}

function exact(rows: readonly JsonRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "FALCON24_DATABASE_CONTRACT_INVALID",
      "Falcon24 Authority RPC 必须返回恰好一行。",
    );
  }
  return rows[0]?.value;
}

async function commandWithHash<T extends Record<string, unknown>>(command: T) {
  return { ...command, command_hash: await sha256ContentHash(command) } as const;
}

export function createPostgresFalcon24AuthorityEpoch(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  const invoke = async <T>(options: {
    readonly capability: unknown;
    readonly access: "READ" | "WRITE";
    readonly operation: string;
    readonly correlation_id?: string;
    readonly sql: string;
    readonly command?: unknown;
    readonly parse: (value: unknown) => T | Promise<T>;
  }) =>
    withAppTransaction(
      input.pool,
      input.authorizer,
      options.capability,
      {
        access: options.access,
        allowed_roles: ["OWNER", "ANALYST"],
        operation_name: options.operation,
        ...(options.correlation_id ? { correlation_id: options.correlation_id } : {}),
        map_database_error: mapDatabaseError,
      },
      async ({ client }) => {
        const result = await client.query<JsonRow>(
          options.sql,
          options.command === undefined ? [] : [options.command],
        );
        return await options.parse(exact(result.rows));
      },
    );

  return Object.freeze({
    async loadCurrent(capability: unknown) {
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-authority.load-current",
        sql: "select app_data_agent.load_falcon24_current_authority_epoch() as value",
        parse: (raw) => (raw === null ? null : falcon24AuthorityBindingSchema.parse(raw)),
      });
    },

    async loadRunBinding(capability: unknown, candidate: unknown) {
      const request = falcon24RunAuthorityLookupSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-run-authority-load@2.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-authority.load-run",
        correlation_id: request.run_id,
        sql: "select app_data_agent.load_falcon24_run_authority_binding($1::jsonb) as value",
        command,
        parse: (raw) => falcon24AuthorityBindingSchema.parse(raw),
      });
    },

    async commitUiReceipt(capability: unknown, candidate: unknown) {
      const receipt = falcon24UiReceiptV2Schema.parse(
        await verifyFalcon24UiReceiptDocument(candidate),
      );
      const receiptKind =
        receipt.schema_version === "falcon24-qa-e2e-receipt@2.0.0" ? "QA_E2E" : "TRACE_UI";
      const command = await commandWithHash({
        schema_version: "falcon24-ui-receipt-commit@2.0.0" as const,
        run_id: receipt.run_id,
        receipt_kind: receiptKind,
        receipt,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.commit-ui-receipt",
        correlation_id: receipt.run_id,
        sql: "select app_data_agent.commit_falcon24_ui_receipt($1::jsonb) as value",
        command,
        parse: (raw) =>
          z
            .strictObject({
              disposition: z.enum(["CREATED", "REPLAYED"]),
              receipt: falcon24UiReceiptV2Schema,
            })
            .parse(raw),
      });
    },

    async loadUiReceipts(capability: unknown, candidate: unknown) {
      const request = falcon24RunAuthorityLookupSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-ui-receipts-load@2.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-authority.load-ui-receipts",
        correlation_id: request.run_id,
        sql: "select app_data_agent.load_falcon24_ui_receipts($1::jsonb) as value",
        command,
        parse: (raw) =>
          z
            .strictObject({
              schema_version: z.literal("falcon24-ui-receipt-set@2.0.0"),
              run_id: z.uuid(),
              authority: falcon24AuthorityBindingSchema,
              receipts: z.array(falcon24UiReceiptDocumentSchema),
            })
            .parse(raw),
      });
    },

    async beginStaging(capability: unknown, candidate: unknown) {
      const request = falcon24StagingSessionRequestV2Schema.parse(candidate);
      const command = await commandWithHash(request);
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.begin-staging",
        correlation_id: request.staging_id,
        sql: "select app_data_agent.begin_falcon24_authority_staging_session($1::jsonb) as value",
        command,
        parse: (raw) => stagingSessionSchema.parse(raw),
      });
    },

    async recordReceipt(capability: unknown, candidate: unknown) {
      const receipt = await verifyFalcon24StagingReceiptV2(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-staging-receipt-record@2.0.0" as const,
        authority_epoch: receipt.authority_epoch,
        receipt,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.record-receipt",
        correlation_id: receipt.staging_id,
        sql: "select app_data_agent.record_falcon24_authority_staging_receipt($1::jsonb) as value",
        command,
        parse: (raw) => verifyFalcon24StagingReceiptV2(raw),
      });
    },

    async stageBaseline(capability: unknown, candidate: unknown) {
      const request = falcon24StageBaselineRequestV2Schema.parse(candidate);
      const baseline = falcon24AuthorityBaselineV2Schema.parse(
        await verifyFalcon24AuthorityBaselineDocument(request.baseline),
      );
      const command = await commandWithHash({
        schema_version: request.schema_version,
        authority_epoch: request.authority_epoch,
        staging_id: request.staging_id,
        baseline,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.stage-baseline",
        correlation_id: request.staging_id,
        sql: "select app_data_agent.stage_falcon24_authority_baseline($1::jsonb) as value",
        command,
        parse: async (raw) =>
          falcon24AuthorityBaselineV2Schema.parse(
            await verifyFalcon24AuthorityBaselineDocument(raw),
          ),
      });
    },

    async beginActivationAttempt(capability: unknown, candidate: unknown) {
      const request = falcon24ActivationAttemptRequestV2Schema.parse(candidate);
      const command = await commandWithHash(request);
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.begin-activation",
        correlation_id: request.attempt_id,
        sql: "select app_data_agent.begin_falcon24_authority_activation_attempt($1::jsonb) as value",
        command,
        parse: (raw) => falcon24ActivationAttemptDocumentSchema.parse(raw),
      });
    },

    async holdActivationAttempt(capability: unknown, candidate: unknown) {
      const request = falcon24ActivationHoldRequestV2Schema.parse(candidate);
      const command = await commandWithHash(request);
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.hold-activation",
        correlation_id: request.attempt_id,
        sql: "select app_data_agent.hold_falcon24_authority_activation_attempt($1::jsonb) as value",
        command,
        parse: (raw) => falcon24ActivationAttemptDocumentSchema.parse(raw),
      });
    },

    async activate(capability: unknown, candidate: unknown) {
      const request = falcon24ActivationRequestV2Schema.parse(candidate);
      const command = await commandWithHash(request);
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.activate",
        correlation_id: request.attempt_id,
        sql: "select app_data_agent.activate_falcon24_authority($1::jsonb) as value",
        command,
        parse: (raw) => falcon24AuthorityBindingV2Schema.parse(raw),
      });
    },
  });
}

export type PostgresFalcon24AuthorityEpoch = ReturnType<
  typeof createPostgresFalcon24AuthorityEpoch
>;
