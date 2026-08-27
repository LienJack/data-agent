import { contentHashSchema, sha256ContentHash } from "@data-agent/contracts/common";
import {
  falcon24AcceptanceFailureLayerSchema,
  falcon24AgentAnalysisRunResultSchema,
  falcon24QualificationGateIdSchema,
  falcon24QualificationStageSchema,
  falcon24ResolutionTraceGateReceiptDocumentSchema,
  falcon24ResolutionTraceUiGateReceiptDocumentSchema,
  falcon24SandboxReclamationReceiptDocumentSchema,
  verifyFalcon24QualificationManifestDocument,
  verifyFalcon24ResolutionTraceGateReceiptDocument,
  verifyFalcon24ResolutionTraceUiGateReceiptDocument,
  verifyFalcon24SandboxReclamationReceiptDocument,
} from "@data-agent/contracts/evals";
import { falcon24AuthorityPersistenceBindingSchema } from "@data-agent/contracts/runs";
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
const qualificationStatusSchema = z.enum(["READY", "RUNNING", "HOLD", "PASSED"]);
const slotStatusSchema = z.enum(["PLANNED", "CLAIMED", "VERIFIED", "HOLD"]);

const qualificationRowSchema = z.strictObject({
  app_id: canonicalImmutableIdSchema,
  tenant_id: canonicalImmutableIdSchema,
  environment: z.string().min(1).max(64),
  principal_id: canonicalImmutableIdSchema,
  ...falcon24AuthorityPersistenceBindingSchema.shape,
  qualification_id: falcon24QualificationGateIdSchema,
  attempt_id: canonicalImmutableIdSchema,
  qualification_version: z.number().int().positive().safe(),
  source_commit: z.string().regex(/^[0-9a-f]{40}$/u),
  source_fingerprint: contentHashSchema,
  frozen_contract_hash: contentHashSchema,
  semantic_release_hash: contentHashSchema,
  schema_snapshot_hash: contentHashSchema,
  operator_registry_digest: contentHashSchema,
  model_provider: z.literal("deepseek"),
  model_id: z.string().min(1).max(128),
  model_config_hash: contentHashSchema,
  web_build_hash: contentHashSchema,
  runtime_attestation_hash: contentHashSchema,
  diagnostic_attempt_id: canonicalImmutableIdSchema.nullable(),
  diagnostic_run_id: canonicalImmutableIdSchema.nullable(),
  diagnostic_receipt_hash: contentHashSchema.nullable(),
  manifest_hash: contentHashSchema,
  slot_count: z.literal(16),
  next_slot_ordinal: z.number().int().min(0).max(16),
  status: qualificationStatusSchema,
  first_failure_run_id: canonicalImmutableIdSchema.nullable(),
  first_failure_layer: falcon24AcceptanceFailureLayerSchema.nullable(),
  first_failure_code: failureCodeSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

const qualificationSlotRowSchema = z.strictObject({
  app_id: canonicalImmutableIdSchema,
  tenant_id: canonicalImmutableIdSchema,
  environment: z.string().min(1).max(64),
  principal_id: canonicalImmutableIdSchema,
  qualification_id: falcon24QualificationGateIdSchema,
  authority_epoch: falcon24AuthorityPersistenceBindingSchema.shape.authority_epoch,
  ordinal: z.number().int().min(0).max(15),
  slot_id: z.string().regex(/^G[1-4]-0[1-5]$/u),
  stage: falcon24QualificationStageSchema,
  run_id: canonicalImmutableIdSchema,
  case_id: z.string().min(3).max(128),
  prompt: z.string().min(1).max(8_000),
  prompt_hash: contentHashSchema,
  run_variant: z.enum(["COLD", "WARM"]),
  expected_path: z.array(falcon24AcceptanceFailureLayerSchema).length(6),
  status: slotStatusSchema,
  claim_fence_hash: contentHashSchema.nullable(),
  claim_fence_consumed_at: timestampSchema.nullable(),
  trace_closure_hash: contentHashSchema.nullable(),
  trace_gate_receipt_hash: contentHashSchema.nullable(),
  trace_gate_receipt: falcon24ResolutionTraceGateReceiptDocumentSchema.nullable(),
  ui_trace_gate_receipt_hash: contentHashSchema.nullable(),
  ui_trace_gate_receipt: falcon24ResolutionTraceUiGateReceiptDocumentSchema.nullable(),
  result_hash: contentHashSchema.nullable(),
  result_document: falcon24AgentAnalysisRunResultSchema.nullable(),
  sandbox_reclamation_claim_hash: contentHashSchema.nullable(),
  sandbox_reclamation_claim_consumed_at: timestampSchema.nullable(),
  sandbox_reclamation_hash: contentHashSchema.nullable(),
  sandbox_reclamation_receipt: falcon24SandboxReclamationReceiptDocumentSchema.nullable(),
  forced_cleanup_claim_hash: contentHashSchema.nullable(),
  forced_cleanup_claimed_at: timestampSchema.nullable(),
  forced_cleanup_resolved_at: timestampSchema.nullable(),
  forced_cleanup_receipt_hash: contentHashSchema.nullable(),
  forced_cleanup_receipt: falcon24SandboxReclamationReceiptDocumentSchema.nullable(),
  secondary_failure_layer: z.literal("SANDBOX_RECLAMATION").nullable(),
  secondary_failure_code: failureCodeSchema.nullable(),
  claimed_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
});

const identitySchema = z.strictObject({
  qualification_id: falcon24QualificationGateIdSchema,
  run_id: canonicalImmutableIdSchema,
});
const claimSchema = z.strictObject({
  qualification_id: falcon24QualificationGateIdSchema,
  ordinal: z.number().int().min(0).max(15),
  slot_id: z.string().regex(/^G[1-4]-0[1-5]$/u),
  stage: falcon24QualificationStageSchema,
  run_id: canonicalImmutableIdSchema,
  case_id: z.string().min(3).max(128),
  run_variant: z.enum(["COLD", "WARM"]),
  claim_fence_token: canonicalImmutableIdSchema,
});
const holdSchema = identitySchema.extend({
  failure_layer: falcon24AcceptanceFailureLayerSchema,
  failure_code: failureCodeSchema,
});
const submitOutcomeSchema = identitySchema.extend({ observed_failure_code: failureCodeSchema });
const traceSchema = identitySchema.extend({
  receipt: falcon24ResolutionTraceGateReceiptDocumentSchema,
});
const uiTraceSchema = identitySchema.extend({
  receipt: falcon24ResolutionTraceUiGateReceiptDocumentSchema,
});
const resultSchema = identitySchema.extend({
  result_document: falcon24AgentAnalysisRunResultSchema,
});
const reclamationClaimSchema = identitySchema.extend({
  reclamation_claim_token: canonicalImmutableIdSchema,
});
const reclamationRecordSchema = reclamationClaimSchema.extend({
  receipt: falcon24SandboxReclamationReceiptDocumentSchema,
});
const completeSchema = identitySchema.extend({
  result_document: falcon24AgentAnalysisRunResultSchema,
  sandbox_reclamation_hash: contentHashSchema,
});
const forcedCleanupClaimSchema = identitySchema.extend({
  forced_cleanup_token: canonicalImmutableIdSchema,
});
const forcedCleanupResolveSchema = forcedCleanupClaimSchema.extend({
  receipt: falcon24SandboxReclamationReceiptDocumentSchema.nullable(),
  secondary_failure_code: failureCodeSchema.nullable(),
});
const pendingFailedRunSchema = z.strictObject({
  qualification_id: falcon24QualificationGateIdSchema,
  run_id: canonicalImmutableIdSchema,
});
const submitOutcomeResolutionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    schema_version: z.literal("falcon24-qualification-submit-outcome@1.0.0"),
    disposition: z.literal("ACCEPTED"),
    qualification_id: falcon24QualificationGateIdSchema,
    run_id: canonicalImmutableIdSchema,
    claim_fence_hash: contentHashSchema,
    claim_fence_consumed_at: timestampSchema,
  }),
  z.strictObject({
    schema_version: z.literal("falcon24-qualification-submit-outcome@1.0.0"),
    disposition: z.literal("HELD"),
    qualification_id: falcon24QualificationGateIdSchema,
    run_id: canonicalImmutableIdSchema,
    failure_code: failureCodeSchema,
  }),
]);

type JsonRow = { readonly value: unknown };

const STABLE_DATABASE_ERRORS = new Set([
  "FALCON24_QUALIFICATION_COMMAND_INVALID",
  "FALCON24_QUALIFICATION_MANIFEST_INVALID",
  "FALCON24_E1_GATE_BASELINE_MISMATCH",
  "FALCON24_E1_GATE_ATTEMPT_IMMUTABLE",
  "FALCON24_E1_GATE_ATTEMPT_FENCE_INVALID",
  "FALCON24_E1_GATE_ATTEMPT_MISMATCH",
  "FALCON24_E1_UI_RECEIPT_PAIR_REQUIRED",
  "FALCON24_GATE_EPOCH_MISMATCH",
  "FALCON24_GATE_BASELINE_MISMATCH",
  "FALCON24_GATE_ATTEMPT_IMMUTABLE",
  "FALCON24_GATE_ATTEMPT_FENCE_INVALID",
  "FALCON24_GATE_ATTEMPT_MISMATCH",
  "FALCON24_QUALIFICATION_DIAGNOSTIC_REQUIRED",
  "FALCON24_UI_RECEIPT_PAIR_REQUIRED",
  "FALCON24_QUALIFICATION_NOT_FOUND",
  "FALCON24_QUALIFICATION_SLOT_NOT_FOUND",
  "FALCON24_QUALIFICATION_VERSION_NOT_NEXT",
  "FALCON24_QUALIFICATION_PREVIOUS_ACTIVE",
  "FALCON24_QUALIFICATION_CHANGE_REQUIRED",
  "FALCON24_QUALIFICATION_HOLD",
  "FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID",
  "FALCON24_QUALIFICATION_SLOT_MISMATCH",
  "FALCON24_QUALIFICATION_SUBMIT_FENCE_INVALID",
  "FALCON24_QUALIFICATION_SUBMIT_FENCE_MISMATCH",
  "FALCON24_QUALIFICATION_SUBMIT_FENCE_ALREADY_CONSUMED",
  "FALCON24_QUALIFICATION_SUBMIT_OUTCOME_UNKNOWN",
  "FALCON24_QUALIFICATION_STAGE_INVALID",
  "FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH",
  "FALCON24_QUALIFICATION_ACTUAL_RUN_NOT_RUNNING",
  "FALCON24_QUALIFICATION_TRACE_REQUIRED",
  "FALCON24_QUALIFICATION_UI_TRACE_REQUIRED",
  "FALCON24_QUALIFICATION_SANDBOX_RECLAMATION_REQUIRED",
  "FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID",
  "FALCON24_QUALIFICATION_FORCED_CLEANUP_ALREADY_CLAIMED",
  "FALCON24_QUALIFICATION_FORCED_CLEANUP_REPLAY_MISMATCH",
  "FALCON24_QUALIFICATION_PENDING_FAILED_RUN_AMBIGUOUS",
  "FALCON24_QUALIFICATION_COMPLETION_INVALID",
  "FALCON24_PREVIOUS_QUALIFICATION_ACTIVE",
  "FALCON24_QUALIFICATION_ALREADY_PASSED",
]);

function mapDatabaseError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? (error as { readonly message?: unknown }).message
      : null;
  if (typeof message !== "string" || !STABLE_DATABASE_ERRORS.has(message)) return null;
  return {
    ok: false as const,
    error: { code: message, message: "Falcon24 资格门禁拒绝当前操作。", retryable: false },
  };
}

function exact(rows: readonly JsonRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "FALCON24_QUALIFICATION_DATABASE_CONTRACT_INVALID",
      "Falcon24 Qualification RPC 必须返回恰好一行。",
    );
  }
  return rows[0]?.value;
}

async function commandWithHash<T extends Record<string, unknown>>(command: T) {
  return { ...command, command_hash: await sha256ContentHash(command) } as const;
}

function assertIdentity<T extends { readonly qualification_id: string; readonly run_id?: string }>(
  value: T,
  expected: { readonly qualification_id: string; readonly run_id?: string },
): T {
  if (
    value.qualification_id !== expected.qualification_id ||
    (expected.run_id !== undefined && value.run_id !== expected.run_id)
  ) {
    throw new PersistenceBoundaryError(
      "FALCON24_QUALIFICATION_DATABASE_CONTRACT_INVALID",
      "Falcon24 Qualification RPC 返回了不同的权威身份。",
    );
  }
  return value;
}

export function createPostgresFalcon24QualificationAuthority(input: {
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
    readonly parse: (value: unknown) => T;
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
          options.command ? [options.command] : [],
        );
        return options.parse(exact(result.rows));
      },
    );

  return Object.freeze({
    async load(capability: unknown, candidate: { readonly qualification_id: unknown }) {
      const request = z
        .strictObject({ qualification_id: falcon24QualificationGateIdSchema })
        .parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-load@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-qualification.load",
        sql: "select app_data_agent.load_falcon24_qualification($1::jsonb) as value",
        command,
        parse: (raw) =>
          raw === null ? null : assertIdentity(qualificationRowSchema.parse(raw), request),
      });
    },

    async loadSlot(capability: unknown, candidate: unknown) {
      const request = identitySchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-slot-load@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-qualification.load-slot",
        correlation_id: request.run_id,
        sql: "select app_data_agent.load_falcon24_qualification_slot($1::jsonb) as value",
        command,
        parse: (raw) =>
          raw === null ? null : assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },

    async loadPendingFailedRun(capability: unknown) {
      return invoke({
        capability,
        access: "READ",
        operation: "falcon24-qualification.load-pending-failed-run",
        sql: "select app_data_agent.load_falcon24_qualification_pending_failed_run() as value",
        parse: (raw) => (raw === null ? null : pendingFailedRunSchema.parse(raw)),
      });
    },

    async begin(capability: unknown, candidate: unknown) {
      const manifest = await verifyFalcon24QualificationManifestDocument(candidate);
      if (manifest.schema_version === "falcon24-qualification-manifest@1.0.0") {
        throw new TypeError("FALCON24_QUALIFICATION_HISTORICAL_MANIFEST_READ_ONLY");
      }
      if (
        (manifest.authority_epoch === "E4") !==
        (manifest.schema_version === "falcon24-qualification-manifest@3.0.0")
      ) {
        throw new TypeError("FALCON24_QUALIFICATION_DIAGNOSTIC_REQUIRED");
      }
      const command = await commandWithHash({
        schema_version:
          manifest.schema_version === "falcon24-qualification-manifest@3.0.0"
            ? ("falcon24-qualification-begin@3.0.0" as const)
            : ("falcon24-qualification-begin@2.0.0" as const),
        manifest,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.begin",
        sql: "select app_data_agent.begin_falcon24_qualification($1::jsonb) as value",
        command,
        parse: (raw) => {
          const row = assertIdentity(qualificationRowSchema.parse(raw), manifest);
          if (
            row.attempt_id !== manifest.attempt_id ||
            row.authority_baseline_hash !== manifest.authority_baseline_hash ||
            row.manifest_hash !== manifest.manifest_hash ||
            row.source_commit !== manifest.source_commit ||
            row.source_fingerprint !== manifest.source_fingerprint ||
            row.frozen_contract_hash !== manifest.frozen_contract_hash ||
            row.semantic_release_hash !== manifest.semantic_release_hash ||
            row.schema_snapshot_hash !== manifest.schema_snapshot_hash ||
            row.operator_registry_digest !== manifest.operator_registry_digest ||
            row.model_config_hash !== manifest.model_config_hash ||
            row.web_build_hash !== manifest.web_build_hash ||
            row.runtime_attestation_hash !== manifest.runtime_attestation_hash
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_QUALIFICATION_DATABASE_CONTRACT_INVALID",
              "Falcon24 Qualification begin 未冻结完整 Manifest 身份。",
            );
          }
          if (
            manifest.schema_version === "falcon24-qualification-manifest@3.0.0" &&
            (row.diagnostic_attempt_id !== manifest.diagnostic_receipt_ref.attempt_id ||
              row.diagnostic_run_id !== manifest.diagnostic_receipt_ref.run_id ||
              row.diagnostic_receipt_hash !== manifest.diagnostic_receipt_ref.receipt_hash)
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_QUALIFICATION_DATABASE_CONTRACT_INVALID",
              "Falcon24 E4 Qualification begin 未冻结 PASSED diagnostic receipt。",
            );
          }
          return row;
        },
      });
    },

    async claim(capability: unknown, candidate: unknown) {
      const request = claimSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-slot-claim@1.0.0" as const,
        ...request,
      });
      const expectedFenceHash = await sha256ContentHash({
        claim_fence_token: request.claim_fence_token,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.claim",
        correlation_id: request.run_id,
        sql: "select app_data_agent.claim_falcon24_qualification_slot($1::jsonb) as value",
        command,
        parse: (raw) => {
          const slot = assertIdentity(qualificationSlotRowSchema.parse(raw), request);
          if (
            slot.ordinal !== request.ordinal ||
            slot.slot_id !== request.slot_id ||
            slot.stage !== request.stage ||
            slot.case_id !== request.case_id ||
            slot.run_variant !== request.run_variant ||
            slot.status !== "CLAIMED" ||
            slot.claim_fence_hash !== expectedFenceHash ||
            slot.claim_fence_consumed_at !== null
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_QUALIFICATION_DATABASE_CONTRACT_INVALID",
              "Falcon24 Qualification claim 未绑定 exact slot/fence。",
            );
          }
          return slot;
        },
      });
    },

    async hold(capability: unknown, candidate: unknown) {
      const request = holdSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-hold@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.hold",
        correlation_id: request.run_id,
        sql: "select app_data_agent.hold_falcon24_qualification($1::jsonb) as value",
        command,
        parse: (raw) => {
          const row = assertIdentity(qualificationRowSchema.parse(raw), {
            qualification_id: request.qualification_id,
          });
          if (
            row.status !== "HOLD" ||
            row.first_failure_run_id !== request.run_id ||
            row.first_failure_layer !== request.failure_layer ||
            row.first_failure_code !== request.failure_code
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_QUALIFICATION_DATABASE_CONTRACT_INVALID",
              "Falcon24 Qualification HOLD 未冻结首个失败。",
            );
          }
          return row;
        },
      });
    },

    async resolveSubmitOutcome(capability: unknown, candidate: unknown) {
      const request = submitOutcomeSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-submit-outcome@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.resolve-submit-outcome",
        correlation_id: request.run_id,
        sql: "select app_data_agent.resolve_falcon24_qualification_submit_outcome($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(submitOutcomeResolutionSchema.parse(raw), request),
      });
    },

    async stageResult(capability: unknown, candidate: unknown) {
      const request = resultSchema.parse(candidate);
      if (request.result_document.run_id !== request.run_id) {
        throw new TypeError("FALCON24_QUALIFICATION_RESULT_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-result-stage@1.0.0" as const,
        qualification_id: request.qualification_id,
        run_id: request.run_id,
        result_hash: await sha256ContentHash(request.result_document),
        result_document: request.result_document,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.stage-result",
        correlation_id: request.run_id,
        sql: "select app_data_agent.stage_falcon24_qualification_result($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },

    async stageTrace(capability: unknown, candidate: unknown) {
      const request = traceSchema.parse(candidate);
      const receipt = await verifyFalcon24ResolutionTraceGateReceiptDocument(request.receipt);
      if (receipt.campaign_id !== request.qualification_id || receipt.run_id !== request.run_id) {
        throw new TypeError("FALCON24_QUALIFICATION_TRACE_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-trace-stage@1.0.0" as const,
        qualification_id: request.qualification_id,
        run_id: request.run_id,
        trace_closure_hash: receipt.trace_hash,
        trace_gate_receipt_hash: receipt.receipt_hash,
        trace_gate_receipt: receipt,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.stage-trace",
        correlation_id: request.run_id,
        sql: "select app_data_agent.stage_falcon24_qualification_trace($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },

    async stageUiTrace(capability: unknown, candidate: unknown) {
      const request = uiTraceSchema.parse(candidate);
      const receipt = await verifyFalcon24ResolutionTraceUiGateReceiptDocument(request.receipt);
      if (receipt.campaign_id !== request.qualification_id || receipt.run_id !== request.run_id) {
        throw new TypeError("FALCON24_QUALIFICATION_UI_TRACE_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-ui-trace-stage@1.0.0" as const,
        qualification_id: request.qualification_id,
        run_id: request.run_id,
        trace_closure_hash: receipt.trace_hash,
        ui_trace_gate_receipt_hash: receipt.receipt_hash,
        ui_trace_gate_receipt: receipt,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.stage-ui-trace",
        correlation_id: request.run_id,
        sql: "select app_data_agent.stage_falcon24_qualification_ui_trace($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },

    async claimSandboxReclamation(capability: unknown, candidate: unknown) {
      const request = reclamationClaimSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-sandbox-reclamation-claim@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.claim-sandbox-reclamation",
        correlation_id: request.run_id,
        sql: "select app_data_agent.claim_falcon24_qualification_sandbox_reclamation($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },

    async recordSandboxReclamation(capability: unknown, candidate: unknown) {
      const request = reclamationRecordSchema.parse(candidate);
      const receipt = await verifyFalcon24SandboxReclamationReceiptDocument(request.receipt);
      if (receipt.campaign_id !== request.qualification_id || receipt.run_id !== request.run_id) {
        throw new TypeError("FALCON24_QUALIFICATION_SANDBOX_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-sandbox-reclamation-record@1.0.0" as const,
        qualification_id: request.qualification_id,
        run_id: request.run_id,
        reclamation_claim_token: request.reclamation_claim_token,
        sandbox_reclamation_hash: receipt.receipt_hash,
        sandbox_reclamation_receipt: receipt,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.record-sandbox-reclamation",
        correlation_id: request.run_id,
        sql: "select app_data_agent.record_falcon24_qualification_sandbox_reclamation($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },

    async complete(capability: unknown, candidate: unknown) {
      const request = completeSchema.parse(candidate);
      if (request.result_document.run_id !== request.run_id) {
        throw new TypeError("FALCON24_QUALIFICATION_COMPLETION_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-slot-complete@1.0.0" as const,
        qualification_id: request.qualification_id,
        run_id: request.run_id,
        expected_result_hash: await sha256ContentHash(request.result_document),
        sandbox_reclamation_hash: request.sandbox_reclamation_hash,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.complete",
        correlation_id: request.run_id,
        sql: "select app_data_agent.complete_falcon24_qualification_slot($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationRowSchema.parse(raw), request),
      });
    },

    async claimForcedCleanup(capability: unknown, candidate: unknown) {
      const request = forcedCleanupClaimSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-forced-cleanup-claim@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.claim-forced-cleanup",
        correlation_id: request.run_id,
        sql: "select app_data_agent.claim_falcon24_qualification_forced_cleanup($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },

    async resolveForcedCleanup(capability: unknown, candidate: unknown) {
      const request = forcedCleanupResolveSchema.parse(candidate);
      if ((request.receipt === null) === (request.secondary_failure_code === null)) {
        throw new TypeError("FALCON24_QUALIFICATION_FORCED_CLEANUP_OUTCOME_INVALID");
      }
      const receipt =
        request.receipt === null
          ? null
          : await verifyFalcon24SandboxReclamationReceiptDocument(request.receipt);
      if (
        receipt !== null &&
        (receipt.campaign_id !== request.qualification_id || receipt.run_id !== request.run_id)
      ) {
        throw new TypeError("FALCON24_QUALIFICATION_FORCED_CLEANUP_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-qualification-forced-cleanup-resolve@1.0.0" as const,
        qualification_id: request.qualification_id,
        run_id: request.run_id,
        forced_cleanup_token: request.forced_cleanup_token,
        forced_cleanup_receipt_hash: receipt?.receipt_hash ?? null,
        forced_cleanup_receipt: receipt,
        secondary_failure_code: request.secondary_failure_code,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "falcon24-qualification.resolve-forced-cleanup",
        correlation_id: request.run_id,
        sql: "select app_data_agent.resolve_falcon24_qualification_forced_cleanup($1::jsonb) as value",
        command,
        parse: (raw) => assertIdentity(qualificationSlotRowSchema.parse(raw), request),
      });
    },
  });
}
