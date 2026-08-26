import { sha256ContentHash } from "@data-agent/contracts/common";
import { verifyFalcon24AuthorityBaseline } from "@data-agent/contracts/evals";
import {
  falcon24AuthorityBindingSchema,
  falcon24E1ActivationAttemptRequestSchema,
  falcon24E1ActivationAttemptSchema,
  falcon24E1ActivationHoldRequestSchema,
  falcon24E1ActivationRequestSchema,
  falcon24E1StageBaselineRequestSchema,
  falcon24E1StagingSessionRequestSchema,
  falcon24E1UiReceiptSchema,
  falcon24RunAuthorityLookupSchema,
  verifyFalcon24E1StagingReceipt,
  verifyFalcon24E1UiReceipt,
} from "@data-agent/contracts/runs";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const stagingSessionSchema = z.strictObject({
  schema_version: z.literal("falcon24-e1-staging-session@1.0.0"),
  staging_id: z.uuid(),
  retained_assets_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  status: z.enum(["STAGED", "HOLD", "CONSUMED"]),
});

const STABLE_DATABASE_ERRORS = new Set([
  "FALCON24_E1_STAGING_SESSION_INVALID",
  "FALCON24_E1_STAGING_IDENTITY_CONFLICT",
  "FALCON24_E1_STAGING_SESSION_NOT_FOUND",
  "FALCON24_E1_STAGING_SESSION_TERMINAL",
  "FALCON24_E1_STAGING_RECEIPT_INVALID",
  "FALCON24_E1_STAGING_RECEIPT_CONFLICT",
  "FALCON24_E1_STAGING_INCOMPLETE",
  "FALCON24_E1_BASELINE_INVALID",
  "FALCON24_E1_BASELINE_NOT_FOUND",
  "FALCON24_E1_BASELINE_NOT_STAGED",
  "FALCON24_E1_BASELINE_IDENTITY_CONFLICT",
  "FALCON24_E1_ACTIVATION_ATTEMPT_INVALID",
  "FALCON24_E1_ACTIVATION_ATTEMPT_NOT_FOUND",
  "FALCON24_E1_ACTIVATION_ATTEMPT_MISMATCH",
  "FALCON24_E1_ACTIVATION_ATTEMPT_CONFLICT",
  "FALCON24_E1_ACTIVATION_ATTEMPT_TERMINAL",
  "FALCON24_E1_ACTIVATION_HOLD_INVALID",
  "FALCON24_E1_ACTIVATION_HOLD_CONFLICT",
  "FALCON24_E1_ACTIVATION_INVALID",
  "FALCON24_E1_ACTIVATION_PREFLIGHT_FAILED",
  "FALCON24_E1_ALREADY_ACTIVE",
  "FALCON24_E1_NOT_ACTIVE",
  "FALCON24_E1_RUN_AUTHORITY_LOAD_INVALID",
  "FALCON24_E1_RUN_NOT_FOUND",
  "FALCON24_E1_UI_RECEIPT_COMMAND_INVALID",
  "FALCON24_E1_UI_RECEIPT_INVALID",
  "FALCON24_E1_QA_E2E_RECEIPT_INVALID",
  "FALCON24_E1_TRACE_UI_RECEIPT_INVALID",
  "FALCON24_E1_UI_RECEIPT_RUN_NOT_READY",
  "FALCON24_E1_UI_RECEIPT_AUTHORITY_MISMATCH",
  "FALCON24_E1_UI_RECEIPT_ARTIFACT_MISMATCH",
  "FALCON24_E1_UI_RECEIPT_REPLAY_MISMATCH",
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
      message: "Falcon24 E1 PostgreSQL Authority 拒绝当前操作。",
      retryable: false,
    },
  };
}

function exact(rows: readonly JsonRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "FALCON24_E1_DATABASE_CONTRACT_INVALID",
      "Falcon24 E1 Authority RPC 必须返回恰好一行。",
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
        operation: "falcon24-e1-authority.load-current",
        sql: "select app_data_agent.load_falcon24_current_authority_epoch() as value",
        parse: (raw) => (raw === null ? null : falcon24AuthorityBindingSchema.parse(raw)),
      });
    },

    async loadRunBinding(capability: unknown, candidate: unknown) {
      const request = falcon24RunAuthorityLookupSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-run-authority-load@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-e1-authority.load-run",
        correlation_id: request.run_id,
        sql: "select app_data_agent.load_falcon24_run_authority_binding($1::jsonb) as value",
        command,
        parse: (raw) => falcon24AuthorityBindingSchema.parse(raw),
      });
    },

    async commitUiReceipt(capability: unknown, candidate: unknown) {
      const receipt = await verifyFalcon24E1UiReceipt(candidate);
      const receiptKind =
        receipt.schema_version === "falcon24-qa-e2e-receipt@1.0.0" ? "QA_E2E" : "TRACE_UI";
      const command = await commandWithHash({
        schema_version: "falcon24-e1-ui-receipt-commit@1.0.0" as const,
        run_id: receipt.run_id,
        receipt_kind: receiptKind,
        receipt,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-e1-authority.commit-ui-receipt",
        correlation_id: receipt.run_id,
        sql: "select app_data_agent.commit_falcon24_e1_ui_receipt($1::jsonb) as value",
        command,
        parse: (raw) =>
          z
            .strictObject({
              disposition: z.enum(["CREATED", "REPLAYED"]),
              receipt: falcon24E1UiReceiptSchema,
            })
            .parse(raw),
      });
    },

    async beginStaging(capability: unknown, candidate: unknown) {
      const request = falcon24E1StagingSessionRequestSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-e1-staging-session-begin@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-e1-authority.begin-staging",
        correlation_id: request.staging_id,
        sql: "select app_data_agent.begin_falcon24_e1_staging_session($1::jsonb) as value",
        command,
        parse: (raw) => stagingSessionSchema.parse(raw),
      });
    },

    async recordReceipt(capability: unknown, candidate: unknown) {
      const receipt = await verifyFalcon24E1StagingReceipt(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-e1-staging-receipt-record@1.0.0" as const,
        receipt,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-e1-authority.record-receipt",
        correlation_id: receipt.staging_id,
        sql: "select app_data_agent.record_falcon24_e1_staging_receipt($1::jsonb) as value",
        command,
        parse: (raw) => verifyFalcon24E1StagingReceipt(raw),
      });
    },

    async stageBaseline(capability: unknown, candidate: unknown) {
      const request = falcon24E1StageBaselineRequestSchema.parse(candidate);
      const baseline = await verifyFalcon24AuthorityBaseline(request.baseline);
      const command = await commandWithHash({
        schema_version: "falcon24-e1-baseline-stage@1.0.0" as const,
        staging_id: request.staging_id,
        baseline,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-e1-authority.stage-baseline",
        correlation_id: request.staging_id,
        sql: "select app_data_agent.stage_falcon24_e1_authority_baseline($1::jsonb) as value",
        command,
        parse: (raw) => verifyFalcon24AuthorityBaseline(raw),
      });
    },

    async beginActivationAttempt(capability: unknown, candidate: unknown) {
      const request = falcon24E1ActivationAttemptRequestSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-e1-activation-attempt-begin@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-e1-authority.begin-activation",
        correlation_id: request.attempt_id,
        sql: "select app_data_agent.begin_falcon24_e1_activation_attempt($1::jsonb) as value",
        command,
        parse: (raw) => falcon24E1ActivationAttemptSchema.parse(raw),
      });
    },

    async holdActivationAttempt(capability: unknown, candidate: unknown) {
      const request = falcon24E1ActivationHoldRequestSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-e1-activation-attempt-hold@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-e1-authority.hold-activation",
        correlation_id: request.attempt_id,
        sql: "select app_data_agent.hold_falcon24_e1_activation_attempt($1::jsonb) as value",
        command,
        parse: (raw) => falcon24E1ActivationAttemptSchema.parse(raw),
      });
    },

    async activate(capability: unknown, candidate: unknown) {
      const request = falcon24E1ActivationRequestSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-e1-authority-activate@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-e1-authority.activate",
        correlation_id: request.attempt_id,
        sql: "select app_data_agent.activate_falcon24_e1_authority($1::jsonb) as value",
        command,
        parse: (raw) => falcon24AuthorityBindingSchema.parse(raw),
      });
    },
  });
}

export type PostgresFalcon24AuthorityEpoch = ReturnType<
  typeof createPostgresFalcon24AuthorityEpoch
>;
