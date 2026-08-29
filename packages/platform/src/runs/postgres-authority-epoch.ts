import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  falcon24AuthorityBaselineV2Schema,
  verifyFalcon24AuthorityBaselineDocument,
} from "@data-agent/contracts/evals";
import {
  buildFalcon24ActivationRequestV3,
  buildFalcon24ActivationRequestV4,
  buildFalcon24ActivationRequestV5,
  buildFalcon24ActivationRequestV6,
  falcon24ActivationAttemptDocumentSchema,
  falcon24ActivationAttemptRequestV2Schema,
  falcon24ActivationHoldRequestV2Schema,
  falcon24ActivationRequestV2Schema,
  falcon24AuthorityBindingSchema,
  falcon24AuthorityBindingV2Schema,
  falcon24EpochClosureFailureReceiptSchema,
  falcon24LlmExecutionAuthorityProofSchema,
  falcon24PredecessorDiagnosticFailureSchema,
  falcon24RetainedActivationResultV4Schema,
  falcon24RetainedActivationResultV5Schema,
  falcon24RetainedActivationResultV6Schema,
  falcon24RetainedSemanticReleaseAuthorityProofSchema,
  falcon24RunAuthorityLookupSchema,
  falcon24StageBaselineRequestV2Schema,
  falcon24StagingHoldRequestV2Schema,
  falcon24StagingHoldResultV2Schema,
  falcon24StagingSessionRequestV2Schema,
  falcon24TerminalDiagnosticFailureReceiptRefSchema,
  falcon24UiReceiptDocumentSchema,
  falcon24UiReceiptV2Schema,
  verifyFalcon24LlmExecutionAuthorityProof,
  verifyFalcon24RetainedSemanticReleaseAuthorityProof,
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
  "FALCON24_AUTHORITY_STAGING_HOLD_INVALID",
  "FALCON24_AUTHORITY_STAGING_HOLD_MISMATCH",
  "FALCON24_AUTHORITY_STAGING_HOLD_BASELINE_EXISTS",
  "FALCON24_AUTHORITY_STAGING_HOLD_CONFLICT",
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
  "FALCON24_LLM_EXECUTION_STAGE_ID_INVALID",
  "FALCON24_LLM_EXECUTION_STAGE_NOT_FOUND",
  "FALCON24_LLM_EXECUTION_STAGE_CORRUPT",
  "FALCON24_LLM_EXECUTION_STAGE_REJECT_INVALID",
  "FALCON24_LLM_EXECUTION_STAGE_REJECT_FORBIDDEN",
  "FALCON24_LLM_EXECUTION_STAGE_REJECT_RACE",
  "FALCON24_E7_RECOVERY_CONTEXT_INVALID",
  "FALCON24_E7_RECOVERY_CONTEXT_NOT_ELIGIBLE",
  "FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR",
  "FALCON24_CURRENT_AUTHORITY_NOT_FOUND",
  "FALCON24_AUTHORITY_NOT_ACTIVE",
  "FALCON24_RECOVERY_ACTIVATION_INVALID",
  "FALCON24_RECOVERY_ACTIVATION_PREDECESSOR_DIAGNOSTIC_INVALID",
  "FALCON24_RECOVERY_ACTIVATION_LLM_STAGE_INVALID",
  "FALCON24_RECOVERY_ACTIVATION_RESULT_INVALID",
  "FALCON24_EPOCH_CLOSURE_FAILURE_ID_INVALID",
  "FALCON24_EPOCH_CLOSURE_FAILURE_NOT_FOUND",
  "FALCON24_EPOCH_CLOSURE_FAILURE_COMMAND_INVALID",
  "FALCON24_EPOCH_CLOSURE_FAILURE_NOT_PROVEN",
  "FALCON24_EPOCH_CLOSURE_FAILURE_IDEMPOTENCY_CONFLICT",
  "FALCON24_CLOSURE_RECOVERY_ACTIVATION_INVALID",
  "FALCON24_CLOSURE_RECOVERY_ACTIVATION_SCOPE_FORBIDDEN",
  "FALCON24_CLOSURE_RECOVERY_PREDECESSOR_MISMATCH",
  "FALCON24_CLOSURE_RECOVERY_FAILURE_RECEIPT_MISMATCH",
  "FALCON24_CLOSURE_RECOVERY_LLM_STAGE_MISMATCH",
  "FALCON24_CLOSURE_RECOVERY_LLM_CATALOG_DRIFT",
  "FALCON24_CLOSURE_RECOVERY_LLM_STAGE_PROMOTION_RACE",
  "FALCON24_CLOSURE_RECOVERY_CERTIFICATION_PROMOTION_RACE",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_ACTIVATION_INVALID",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_SCOPE_FORBIDDEN",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_PREDECESSOR_MISMATCH",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_RECEIPT_MISMATCH",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_LLM_STAGE_MISMATCH",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_LLM_CATALOG_DRIFT",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_STAGE_PROMOTION_RACE",
  "FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_CERTIFICATION_PROMOTION_RACE",
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

const llmExecutionStageDocumentSchema = z.strictObject({
  schema_version: z.literal("falcon24-llm-execution-stage@1.0.0"),
  status: z.enum(["STAGED", "PROMOTED", "REJECTED"]),
  proof_document: falcon24LlmExecutionAuthorityProofSchema,
  certification_claims: z.unknown(),
  certification_is_active: z.boolean(),
  staging_command_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  activation_attempt_id: z.uuid().nullable(),
  rejection_reason_code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,127}$/u)
    .nullable(),
  rejection_command_hash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/u)
    .nullable(),
});

async function verifyLlmExecutionStageDocument(raw: unknown) {
  const result = llmExecutionStageDocumentSchema.parse(raw);
  const proof = await verifyFalcon24LlmExecutionAuthorityProof(result.proof_document);
  if (
    (result.status === "STAGED" &&
      (result.certification_is_active ||
        result.activation_attempt_id !== null ||
        result.rejection_reason_code !== null ||
        result.rejection_command_hash !== null)) ||
    (result.status === "PROMOTED" &&
      (!result.certification_is_active ||
        result.activation_attempt_id === null ||
        result.rejection_reason_code !== null ||
        result.rejection_command_hash !== null)) ||
    (result.status === "REJECTED" &&
      (result.certification_is_active ||
        result.activation_attempt_id !== null ||
        result.rejection_reason_code === null ||
        result.rejection_command_hash === null))
  ) {
    throw new TypeError("FALCON24_LLM_EXECUTION_STAGE_CORRUPT");
  }
  return Object.freeze({ ...result, proof_document: proof });
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
    readonly semantic_domain?: string;
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
        if (options.semantic_domain) {
          await client.query("select pg_catalog.set_config('app.semantic_domain',$1,true)", [
            options.semantic_domain,
          ]);
        }
        const result = await client.query<JsonRow>(
          options.sql,
          options.command === undefined ? [] : [options.command],
        );
        return await options.parse(exact(result.rows));
      },
    );

  return Object.freeze({
    async recordEpochClosureFailure(capability: unknown, candidate: unknown) {
      const request = z
        .strictObject({
          receipt_id: z.uuid(),
          idempotency_key: z.string().trim().min(1).max(256),
          expected_authority: falcon24AuthorityBindingV2Schema,
          stage_ref: z.strictObject({
            stage_id: z.uuid(),
            proof_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
          }),
        })
        .parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-epoch-closure-failure-record@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.record-epoch-closure-failure",
        correlation_id: request.receipt_id,
        sql: "select app_data_agent.record_falcon24_epoch_closure_failure($1::jsonb) as value",
        command,
        parse: (raw) => falcon24EpochClosureFailureReceiptSchema.parse(raw),
      });
    },

    async loadEpochClosureFailure(capability: unknown, candidate: unknown) {
      const request = z.strictObject({ receipt_id: z.uuid() }).parse(candidate);
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-authority.load-epoch-closure-failure",
        correlation_id: request.receipt_id,
        sql: "select app_data_agent.load_falcon24_epoch_closure_failure($1::uuid) as value",
        command: request.receipt_id,
        parse: (raw) => falcon24EpochClosureFailureReceiptSchema.parse(raw),
      });
    },

    async loadLlmExecutionStage(capability: unknown, candidate: unknown) {
      const request = z.strictObject({ stage_id: z.uuid() }).parse(candidate);
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-authority.load-llm-execution-stage",
        correlation_id: request.stage_id,
        sql: "select app_data_agent.load_falcon24_llm_execution_certification_stage($1::uuid) as value",
        command: request.stage_id,
        parse: verifyLlmExecutionStageDocument,
      });
    },

    async rejectLlmExecutionStage(capability: unknown, candidate: unknown) {
      const request = z
        .strictObject({
          stage_id: z.uuid(),
          proof_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
          reason_code: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/u),
        })
        .parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-llm-execution-stage-reject@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.reject-llm-execution-stage",
        correlation_id: request.stage_id,
        sql: "select app_data_agent.reject_falcon24_llm_execution_certification_stage($1::jsonb) as value",
        command,
        parse: verifyLlmExecutionStageDocument,
      });
    },

    async loadRecoveryContext(capability: unknown, candidate: unknown) {
      const request = z.strictObject({ attempt_id: z.uuid() }).parse(candidate);
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-authority.load-recovery-context",
        correlation_id: request.attempt_id,
        sql: "select app_data_agent.load_falcon24_e7_recovery_context($1::uuid) as value",
        command: request.attempt_id,
        parse: (raw) => falcon24PredecessorDiagnosticFailureSchema.parse(raw),
      });
    },

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

    async holdStagingSession(capability: unknown, candidate: unknown) {
      const request = falcon24StagingHoldRequestV2Schema.parse(candidate);
      const command = await commandWithHash(request);
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.hold-staging",
        correlation_id: request.staging_id,
        sql: "select app_data_agent.hold_falcon24_authority_staging_session($1::jsonb) as value",
        command,
        parse: (raw) => falcon24StagingHoldResultV2Schema.parse(raw),
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
      if (BigInt(request.authority_epoch.slice(1)) >= 4n) {
        throw new TypeError("FALCON24_COMBINED_SEMANTIC_ACTIVATION_REQUIRED");
      }
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

    async activateRetained(capability: unknown, candidate: unknown) {
      const envelope = z
        .strictObject({
          request: z.unknown(),
          retained_semantic_proof: falcon24RetainedSemanticReleaseAuthorityProofSchema,
        })
        .parse(candidate);
      const proof = await verifyFalcon24RetainedSemanticReleaseAuthorityProof(
        envelope.retained_semantic_proof,
      );
      const command = await buildFalcon24ActivationRequestV3(envelope.request);
      const sameRelease =
        command.expected_semantic_release.release_id === proof.semantic_release.release_id &&
        command.expected_semantic_release.generation === proof.semantic_release.generation &&
        command.expected_semantic_release.release_digest ===
          proof.semantic_release.release_digest &&
        command.expected_semantic_release.datasource_id === proof.semantic_release.datasource_id;
      if (
        command.retained_semantic_proof_hash !== proof.proof_hash ||
        command.scope.app_id !== proof.scope.app_id ||
        command.scope.tenant_id !== proof.scope.tenant_id ||
        command.scope.environment !== proof.scope.environment ||
        command.scope.semantic_domain !== proof.scope.semantic_domain ||
        command.authority_epoch !== proof.authority_epoch ||
        command.expected_current_authority.authority_epoch !==
          proof.expected_current_authority.authority_epoch ||
        command.expected_current_authority.baseline_id !==
          proof.expected_current_authority.baseline_id ||
        command.expected_current_authority.baseline_hash !==
          proof.expected_current_authority.baseline_hash ||
        command.expected_current_authority.activation_attempt_id !==
          proof.expected_current_authority.activation_attempt_id ||
        !sameRelease ||
        command.expected_versions.semantic_pointer !== proof.expected_versions.semantic_pointer ||
        command.expected_versions.semantic_runtime !== proof.expected_versions.semantic_runtime ||
        command.expected_versions.workspace_defaults !== proof.expected_versions.workspace_defaults
      ) {
        throw new TypeError("FALCON24_RETAINED_ACTIVATION_PROOF_MISMATCH");
      }
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.activate-retained",
        correlation_id: command.attempt_id,
        sql: "select app_data_agent.activate_falcon24_authority($1::jsonb) as value",
        command,
        semantic_domain: command.scope.semantic_domain,
        parse: (raw) => falcon24AuthorityBindingV2Schema.parse(raw),
      });
    },

    async activateRetainedWithRecovery(capability: unknown, candidate: unknown) {
      const envelope = z
        .strictObject({
          request: z.unknown(),
          retained_semantic_proof: falcon24RetainedSemanticReleaseAuthorityProofSchema,
          llm_execution_proof: falcon24LlmExecutionAuthorityProofSchema,
        })
        .parse(candidate);
      const [semanticProof, llmProof] = await Promise.all([
        verifyFalcon24RetainedSemanticReleaseAuthorityProof(envelope.retained_semantic_proof),
        verifyFalcon24LlmExecutionAuthorityProof(envelope.llm_execution_proof),
      ]);
      const command = await buildFalcon24ActivationRequestV4(envelope.request);
      const sameRelease =
        command.expected_semantic_release.release_id ===
          semanticProof.semantic_release.release_id &&
        command.expected_semantic_release.generation ===
          semanticProof.semantic_release.generation &&
        command.expected_semantic_release.release_digest ===
          semanticProof.semantic_release.release_digest &&
        command.expected_semantic_release.datasource_id ===
          semanticProof.semantic_release.datasource_id;
      const sameScope =
        command.scope.app_id === semanticProof.scope.app_id &&
        command.scope.tenant_id === semanticProof.scope.tenant_id &&
        command.scope.environment === semanticProof.scope.environment &&
        command.scope.semantic_domain === semanticProof.scope.semantic_domain &&
        command.scope.app_id === llmProof.scope.app_id &&
        command.scope.tenant_id === llmProof.scope.tenant_id &&
        command.scope.environment === llmProof.scope.environment &&
        command.scope.semantic_domain === llmProof.scope.semantic_domain;
      if (
        command.retained_semantic_proof_hash !== semanticProof.proof_hash ||
        command.authority_epoch !== semanticProof.authority_epoch ||
        command.authority_epoch !== llmProof.target_authority_epoch ||
        !sameScope ||
        !sameRelease ||
        command.expected_current_authority.authority_epoch !==
          semanticProof.expected_current_authority.authority_epoch ||
        command.expected_current_authority.baseline_id !==
          semanticProof.expected_current_authority.baseline_id ||
        command.expected_current_authority.baseline_hash !==
          semanticProof.expected_current_authority.baseline_hash ||
        command.expected_current_authority.activation_attempt_id !==
          semanticProof.expected_current_authority.activation_attempt_id ||
        command.expected_versions.semantic_pointer !==
          semanticProof.expected_versions.semantic_pointer ||
        command.expected_versions.semantic_runtime !==
          semanticProof.expected_versions.semantic_runtime ||
        command.expected_versions.workspace_defaults !==
          semanticProof.expected_versions.workspace_defaults ||
        command.llm_execution_stage_ref.stage_id !== llmProof.stage_id ||
        command.llm_execution_stage_ref.proof_hash !== llmProof.proof_hash ||
        semanticProof.worker_build.build_id !== llmProof.worker_build.build_id ||
        semanticProof.worker_build.generation_id !== llmProof.worker_build.generation_id
      ) {
        throw new TypeError("FALCON24_RECOVERY_ACTIVATION_PROOF_MISMATCH");
      }
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.activate-retained-recovery",
        correlation_id: command.attempt_id,
        sql: "select app_data_agent.activate_falcon24_authority($1::jsonb) as value",
        command,
        semantic_domain: command.scope.semantic_domain,
        parse: (raw) => {
          const result = falcon24RetainedActivationResultV4Schema.parse(raw);
          if (
            result.activation_command_hash !== command.command_hash ||
            result.authority.authority_epoch !== command.authority_epoch ||
            result.authority.baseline_id !== command.baseline_id ||
            result.authority.baseline_hash !== command.expected_baseline_hash ||
            result.authority.activation_attempt_id !== command.attempt_id ||
            result.predecessor_diagnostic_receipt.attempt_id !==
              command.predecessor_diagnostic_failure.attempt_id ||
            result.predecessor_diagnostic_receipt.run_id !==
              command.predecessor_diagnostic_failure.run_id ||
            result.llm_execution_certification.stage_id !== llmProof.stage_id ||
            result.llm_execution_certification.proof_hash !== llmProof.proof_hash ||
            result.llm_execution_certification.certification_receipt_ref.content_hash !==
              llmProof.certification_receipt_ref.content_hash ||
            result.llm_execution_certification.execution_profile_hash !==
              llmProof.execution_profile_hash
          ) {
            throw new TypeError("FALCON24_RECOVERY_ACTIVATION_RESULT_INVALID");
          }
          return result;
        },
      });
    },

    async activateRetainedWithClosureRecovery(capability: unknown, candidate: unknown) {
      const envelope = z
        .strictObject({
          request: z.unknown(),
          retained_semantic_proof: falcon24RetainedSemanticReleaseAuthorityProofSchema,
          llm_execution_proof: falcon24LlmExecutionAuthorityProofSchema,
          predecessor_closure_failure: falcon24EpochClosureFailureReceiptSchema,
        })
        .parse(candidate);
      const [semanticProof, llmProof] = await Promise.all([
        verifyFalcon24RetainedSemanticReleaseAuthorityProof(envelope.retained_semantic_proof),
        verifyFalcon24LlmExecutionAuthorityProof(envelope.llm_execution_proof),
      ]);
      const command = await buildFalcon24ActivationRequestV5(envelope.request);
      const failure = envelope.predecessor_closure_failure;
      const sameRelease =
        command.expected_semantic_release.release_id ===
          semanticProof.semantic_release.release_id &&
        command.expected_semantic_release.generation ===
          semanticProof.semantic_release.generation &&
        command.expected_semantic_release.release_digest ===
          semanticProof.semantic_release.release_digest &&
        command.expected_semantic_release.datasource_id ===
          semanticProof.semantic_release.datasource_id;
      const sameScope =
        command.scope.app_id === semanticProof.scope.app_id &&
        command.scope.tenant_id === semanticProof.scope.tenant_id &&
        command.scope.environment === semanticProof.scope.environment &&
        command.scope.semantic_domain === semanticProof.scope.semantic_domain &&
        command.scope.app_id === llmProof.scope.app_id &&
        command.scope.tenant_id === llmProof.scope.tenant_id &&
        command.scope.environment === llmProof.scope.environment &&
        command.scope.semantic_domain === llmProof.scope.semantic_domain;
      if (
        command.retained_semantic_proof_hash !== semanticProof.proof_hash ||
        command.authority_epoch !== semanticProof.authority_epoch ||
        command.authority_epoch !== llmProof.target_authority_epoch ||
        !sameScope ||
        !sameRelease ||
        command.expected_current_authority.authority_epoch !==
          semanticProof.expected_current_authority.authority_epoch ||
        command.expected_current_authority.baseline_id !==
          semanticProof.expected_current_authority.baseline_id ||
        command.expected_current_authority.baseline_hash !==
          semanticProof.expected_current_authority.baseline_hash ||
        command.expected_current_authority.activation_attempt_id !==
          semanticProof.expected_current_authority.activation_attempt_id ||
        command.expected_versions.semantic_pointer !==
          semanticProof.expected_versions.semantic_pointer ||
        command.expected_versions.semantic_runtime !==
          semanticProof.expected_versions.semantic_runtime ||
        command.expected_versions.workspace_defaults !==
          semanticProof.expected_versions.workspace_defaults ||
        command.llm_execution_stage_ref.stage_id !== llmProof.stage_id ||
        command.llm_execution_stage_ref.proof_hash !== llmProof.proof_hash ||
        semanticProof.worker_build.build_id !== llmProof.worker_build.build_id ||
        semanticProof.worker_build.generation_id !== llmProof.worker_build.generation_id ||
        command.predecessor_closure_failure_ref.receipt_id !== failure.receipt_id ||
        command.predecessor_closure_failure_ref.receipt_hash !== failure.receipt_hash ||
        command.predecessor_closure_failure_ref.failure_code !== failure.failure_code ||
        command.expected_current_authority.authority_epoch !== failure.authority.authority_epoch ||
        command.expected_current_authority.baseline_id !== failure.authority.baseline_id ||
        command.expected_current_authority.baseline_hash !== failure.authority.baseline_hash ||
        command.expected_current_authority.activation_attempt_id !==
          failure.authority.activation_attempt_id
      ) {
        throw new TypeError("FALCON24_CLOSURE_RECOVERY_ACTIVATION_PROOF_MISMATCH");
      }
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.activate-retained-closure-recovery",
        correlation_id: command.attempt_id,
        sql: "select app_data_agent.activate_falcon24_authority($1::jsonb) as value",
        command,
        semantic_domain: command.scope.semantic_domain,
        parse: (raw) => {
          const result = falcon24RetainedActivationResultV5Schema.parse(raw);
          if (
            result.activation_command_hash !== command.command_hash ||
            result.authority.authority_epoch !== command.authority_epoch ||
            result.authority.baseline_id !== command.baseline_id ||
            result.authority.baseline_hash !== command.expected_baseline_hash ||
            result.authority.activation_attempt_id !== command.attempt_id ||
            result.predecessor_closure_failure_receipt.receipt_id !== failure.receipt_id ||
            result.predecessor_closure_failure_receipt.receipt_hash !== failure.receipt_hash ||
            result.predecessor_closure_failure_receipt.failure_code !== failure.failure_code ||
            result.llm_execution_certification.stage_id !== llmProof.stage_id ||
            result.llm_execution_certification.proof_hash !== llmProof.proof_hash ||
            result.llm_execution_certification.certification_receipt_ref.content_hash !==
              llmProof.certification_receipt_ref.content_hash ||
            result.llm_execution_certification.execution_profile_hash !==
              llmProof.execution_profile_hash
          ) {
            throw new TypeError("FALCON24_CLOSURE_RECOVERY_ACTIVATION_RESULT_INVALID");
          }
          return result;
        },
      });
    },

    async activateRetainedWithTerminalDiagnosticRecovery(capability: unknown, candidate: unknown) {
      const envelope = z
        .strictObject({
          request: z.unknown(),
          retained_semantic_proof: falcon24RetainedSemanticReleaseAuthorityProofSchema,
          llm_execution_proof: falcon24LlmExecutionAuthorityProofSchema,
          predecessor_diagnostic_receipt: falcon24TerminalDiagnosticFailureReceiptRefSchema,
        })
        .parse(candidate);
      const [semanticProof, llmProof] = await Promise.all([
        verifyFalcon24RetainedSemanticReleaseAuthorityProof(envelope.retained_semantic_proof),
        verifyFalcon24LlmExecutionAuthorityProof(envelope.llm_execution_proof),
      ]);
      const command = await buildFalcon24ActivationRequestV6(envelope.request);
      const failure = envelope.predecessor_diagnostic_receipt;
      const sameRelease =
        command.expected_semantic_release.release_id ===
          semanticProof.semantic_release.release_id &&
        command.expected_semantic_release.generation ===
          semanticProof.semantic_release.generation &&
        command.expected_semantic_release.release_digest ===
          semanticProof.semantic_release.release_digest &&
        command.expected_semantic_release.datasource_id ===
          semanticProof.semantic_release.datasource_id;
      const sameScope =
        command.scope.app_id === semanticProof.scope.app_id &&
        command.scope.tenant_id === semanticProof.scope.tenant_id &&
        command.scope.environment === semanticProof.scope.environment &&
        command.scope.semantic_domain === semanticProof.scope.semantic_domain &&
        command.scope.app_id === llmProof.scope.app_id &&
        command.scope.tenant_id === llmProof.scope.tenant_id &&
        command.scope.environment === llmProof.scope.environment &&
        command.scope.semantic_domain === llmProof.scope.semantic_domain;
      if (
        command.retained_semantic_proof_hash !== semanticProof.proof_hash ||
        command.authority_epoch !== semanticProof.authority_epoch ||
        command.authority_epoch !== llmProof.target_authority_epoch ||
        !sameScope ||
        !sameRelease ||
        command.expected_current_authority.authority_epoch !==
          semanticProof.expected_current_authority.authority_epoch ||
        command.expected_current_authority.baseline_id !==
          semanticProof.expected_current_authority.baseline_id ||
        command.expected_current_authority.baseline_hash !==
          semanticProof.expected_current_authority.baseline_hash ||
        command.expected_current_authority.activation_attempt_id !==
          semanticProof.expected_current_authority.activation_attempt_id ||
        command.expected_versions.semantic_pointer !==
          semanticProof.expected_versions.semantic_pointer ||
        command.expected_versions.semantic_runtime !==
          semanticProof.expected_versions.semantic_runtime ||
        command.expected_versions.workspace_defaults !==
          semanticProof.expected_versions.workspace_defaults ||
        command.llm_execution_stage_ref.stage_id !== llmProof.stage_id ||
        command.llm_execution_stage_ref.proof_hash !== llmProof.proof_hash ||
        semanticProof.worker_build.build_id !== llmProof.worker_build.build_id ||
        semanticProof.worker_build.generation_id !== llmProof.worker_build.generation_id ||
        JSON.stringify(command.predecessor_diagnostic_receipt) !== JSON.stringify(failure)
      ) {
        throw new TypeError("FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_PROOF_MISMATCH");
      }
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-authority.activate-retained-terminal-diagnostic-recovery",
        correlation_id: command.attempt_id,
        sql: "select app_data_agent.activate_falcon24_authority($1::jsonb) as value",
        command,
        semantic_domain: command.scope.semantic_domain,
        parse: (raw) => {
          const result = falcon24RetainedActivationResultV6Schema.parse(raw);
          if (
            result.activation_command_hash !== command.command_hash ||
            result.authority.authority_epoch !== command.authority_epoch ||
            result.authority.baseline_id !== command.baseline_id ||
            result.authority.baseline_hash !== command.expected_baseline_hash ||
            result.authority.activation_attempt_id !== command.attempt_id ||
            JSON.stringify(result.predecessor_diagnostic_receipt) !== JSON.stringify(failure) ||
            result.llm_execution_certification.stage_id !== llmProof.stage_id ||
            result.llm_execution_certification.proof_hash !== llmProof.proof_hash ||
            result.llm_execution_certification.certification_receipt_ref.content_hash !==
              llmProof.certification_receipt_ref.content_hash ||
            result.llm_execution_certification.execution_profile_hash !==
              llmProof.execution_profile_hash
          ) {
            throw new TypeError("FALCON24_TERMINAL_DIAGNOSTIC_RECOVERY_RESULT_INVALID");
          }
          return result;
        },
      });
    },
  });
}

export type PostgresFalcon24AuthorityEpoch = ReturnType<
  typeof createPostgresFalcon24AuthorityEpoch
>;
