import { contentHashSchema, sha256ContentHash } from "@data-agent/contracts/common";
import {
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  falcon24AcceptanceCampaignIdSchema,
  falcon24AcceptanceFailureLayerSchema,
  falcon24AcceptanceRunManifestSchema,
  falcon24AgentAnalysisRunResultSchema,
  falcon24ResolutionTraceGateReceiptSchema,
  falcon24ResolutionTraceUiGateReceiptSchema,
  falcon24SandboxReclamationReceiptSchema,
  verifyFalcon24ResolutionTraceGateReceipt,
  verifyFalcon24ResolutionTraceUiGateReceipt,
  verifyFalcon24SandboxReclamationReceipt,
} from "@data-agent/contracts/evals";
import { canonicalImmutableIdSchema } from "@data-agent/contracts/workspaces";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const CAMPAIGN_POLICY_ID = FALCON24_STRICT_ACCEPTANCE_POLICY_ID;
const campaignIdSchema = falcon24AcceptanceCampaignIdSchema;
const caseIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]{2,127}$/);
const failureCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const campaignStatusSchema = z.enum(["READY", "RUNNING", "HOLD", "PASSED"]);
const runStatusSchema = z.enum(["PLANNED", "CLAIMED", "VERIFIED", "HOLD"]);

const campaignRowSchema = z.strictObject({
  app_id: canonicalImmutableIdSchema,
  tenant_id: canonicalImmutableIdSchema,
  environment: z.string().min(1).max(64),
  principal_id: canonicalImmutableIdSchema,
  campaign_id: campaignIdSchema,
  campaign_version: z.number().int().positive().safe(),
  source_fingerprint: contentHashSchema,
  frozen_contract_hash: contentHashSchema,
  runtime_attestation_hash: contentHashSchema,
  manifest_hash: contentHashSchema,
  policy_id: z.literal(CAMPAIGN_POLICY_ID),
  run_count: z.literal(30),
  next_run_ordinal: z.number().int().min(0).max(30),
  status: campaignStatusSchema,
  first_failure_run_id: canonicalImmutableIdSchema.nullable(),
  first_failure_layer: falcon24AcceptanceFailureLayerSchema.nullable(),
  first_failure_code: failureCodeSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

const campaignRunRowSchema = z.strictObject({
  app_id: canonicalImmutableIdSchema,
  tenant_id: canonicalImmutableIdSchema,
  environment: z.string().min(1).max(64),
  principal_id: canonicalImmutableIdSchema,
  campaign_id: campaignIdSchema,
  run_ordinal: z.number().int().min(0).max(29),
  run_id: canonicalImmutableIdSchema,
  case_id: caseIdSchema,
  run_variant: z.enum(["COLD", "WARM"]),
  repetition: z.number().int().min(1).max(3),
  status: runStatusSchema,
  claim_fence_hash: contentHashSchema.nullable(),
  claim_fence_consumed_at: timestampSchema.nullable(),
  trace_closure_hash: contentHashSchema.nullable(),
  trace_gate_receipt_hash: contentHashSchema.nullable(),
  trace_gate_receipt: falcon24ResolutionTraceGateReceiptSchema.nullable(),
  ui_trace_gate_receipt_hash: contentHashSchema.nullable(),
  ui_trace_gate_receipt: falcon24ResolutionTraceUiGateReceiptSchema.nullable(),
  result_hash: contentHashSchema.nullable(),
  result_document: falcon24AgentAnalysisRunResultSchema.nullable(),
  sandbox_reclamation_recovery_hash: contentHashSchema.nullable(),
  sandbox_reclamation_claim_hash: contentHashSchema.nullable(),
  sandbox_reclamation_claimed_at: timestampSchema.nullable(),
  sandbox_reclamation_claim_expires_at: timestampSchema.nullable(),
  sandbox_reclamation_claim_consumed_at: timestampSchema.nullable(),
  sandbox_reclamation_hash: contentHashSchema.nullable(),
  sandbox_reclamation_receipt: falcon24SandboxReclamationReceiptSchema.nullable(),
  claimed_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
});

const claimInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_ordinal: z.number().int().min(0).max(29),
  run_id: canonicalImmutableIdSchema,
  case_id: caseIdSchema,
  run_variant: z.enum(["COLD", "WARM"]),
  repetition: z.number().int().min(1).max(3),
  claim_fence_token: canonicalImmutableIdSchema,
});

const holdInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  failure_layer: falcon24AcceptanceFailureLayerSchema,
  failure_code: failureCodeSchema,
});
const submitOutcomeInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  observed_failure_code: failureCodeSchema,
});
const submitOutcomeResolutionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    schema_version: z.literal("falcon24-submit-outcome-resolution@1.0.0"),
    disposition: z.literal("HELD"),
    campaign_id: campaignIdSchema,
    run_id: canonicalImmutableIdSchema,
    failure_code: failureCodeSchema,
  }),
  z.strictObject({
    schema_version: z.literal("falcon24-submit-outcome-resolution@1.0.0"),
    disposition: z.literal("ACCEPTED"),
    campaign_id: campaignIdSchema,
    run_id: canonicalImmutableIdSchema,
    claim_fence_hash: contentHashSchema,
    claim_fence_consumed_at: timestampSchema,
  }),
]);

const completeInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  result_document: falcon24AgentAnalysisRunResultSchema,
  sandbox_reclamation_hash: contentHashSchema,
});
const traceStageInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  receipt: falcon24ResolutionTraceGateReceiptSchema,
});
const uiTraceStageInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  receipt: falcon24ResolutionTraceUiGateReceiptSchema,
});
const stageInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  result_document: falcon24AgentAnalysisRunResultSchema,
});
const reclamationRecordInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  reclamation_claim_token: canonicalImmutableIdSchema,
  receipt: falcon24SandboxReclamationReceiptSchema,
});
const runIdentityInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
});
const reclamationClaimInputSchema = runIdentityInputSchema.extend({
  runtime_attestation_hash: contentHashSchema,
  reclamation_recovery_token: canonicalImmutableIdSchema,
  reclamation_claim_token: canonicalImmutableIdSchema,
});
const pendingFailedRunSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
});

type JsonRow = { readonly value: unknown };

const STABLE_DATABASE_ERRORS = new Set([
  "FALCON24_CAMPAIGN_COMMAND_INVALID",
  "FALCON24_CAMPAIGN_MANIFEST_INVALID",
  "FALCON24_CAMPAIGN_BOOTSTRAP_VERSION_INVALID",
  "FALCON24_CAMPAIGN_IDENTITY_CONFLICT",
  "FALCON24_CAMPAIGN_VERSION_NOT_NEXT",
  "FALCON24_PREVIOUS_CAMPAIGN_ACTIVE",
  "FALCON24_CAMPAIGN_CHANGE_REQUIRED",
  "FALCON24_RUN_CLAIM_INVALID",
  "FALCON24_CAMPAIGN_NOT_FOUND",
  "FALCON24_CAMPAIGN_LOAD_INVALID",
  "FALCON24_CAMPAIGN_RUN_LOAD_INVALID",
  "FALCON24_CAMPAIGN_HOLD",
  "FALCON24_RUN_ORDER_OR_STATE_INVALID",
  "FALCON24_RUN_SCHEDULE_MISMATCH",
  "FALCON24_RUN_ALREADY_CLAIMED",
  "FALCON24_QUESTION_ACCEPTANCE_INVALID",
  "FALCON24_SUBMIT_RUN_PREEXISTS",
  "FALCON24_QUESTION_ACCEPTANCE_NOT_READY",
  "FALCON24_SUBMIT_ACCEPTANCE_NOT_ATOMIC",
  "FALCON24_SUBMIT_FENCE_MISMATCH",
  "FALCON24_SUBMIT_FENCE_ALREADY_CONSUMED",
  "FALCON24_SUBMIT_FENCE_REQUIRED",
  "FALCON24_SUBMIT_OUTCOME_INVALID",
  "FALCON24_SUBMIT_OUTCOME_UNKNOWN",
  "FALCON24_SUBMIT_AUTHORITY_CORRUPT",
  "FALCON24_RUN_ACCEPTED_RECOVERY_REQUIRED",
  "FALCON24_CAMPAIGN_HOLD_INVALID",
  "FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH",
  "FALCON24_CAMPAIGN_ALREADY_PASSED",
  "FALCON24_RUN_NOT_CLAIMED",
  "FALCON24_RESULT_STAGE_INVALID",
  "FALCON24_RESULT_STAGE_REPLAY_MISMATCH",
  "FALCON24_TRACE_STAGE_INVALID",
  "FALCON24_TRACE_STAGE_REPLAY_MISMATCH",
  "FALCON24_TRACE_STAGE_REQUIRED",
  "FALCON24_TRACE_GATE_RECEIPT_LOAD_INVALID",
  "FALCON24_UI_TRACE_STAGE_INVALID",
  "FALCON24_UI_TRACE_STAGE_REPLAY_MISMATCH",
  "FALCON24_UI_TRACE_STAGE_REQUIRED",
  "FALCON24_UI_TRACE_GATE_RECEIPT_LOAD_INVALID",
  "FALCON24_ACTUAL_RUN_REQUIRED",
  "FALCON24_ACTUAL_RUN_NOT_TERMINAL",
  "FALCON24_ACTUAL_RUN_NOT_SUCCEEDED",
  "FALCON24_RESULT_STAGE_REQUIRED",
  "FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID",
  "FALCON24_SANDBOX_RECLAMATION_CLAIM_INVALID",
  "FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED",
  "FALCON24_SANDBOX_RECLAMATION_CLAIM_REQUIRED",
  "FALCON24_SANDBOX_RECLAMATION_CLAIM_MISMATCH",
  "FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH",
  "FALCON24_SANDBOX_RECLAMATION_REQUIRED",
  "FALCON24_SANDBOX_ATTESTATION_MISMATCH",
  "FALCON24_SANDBOX_RECLAMATION_LOAD_INVALID",
  "FALCON24_RUN_COMPLETION_INVALID",
  "FALCON24_RUN_COMPLETION_REPLAY_MISMATCH",
  "FALCON24_CAMPAIGN_NOT_RUNNING",
  "FALCON24_RESULTS_LOAD_INVALID",
  "FALCON24_RUN_RESULT_LOAD_INVALID",
  "FALCON24_RUN_NOT_FOUND",
  "FALCON24_PENDING_FAILED_RUN_AMBIGUOUS",
  "RUN_EXECUTION_POLICY_CORRUPT",
]);

function mapDatabaseError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? (error as { readonly message?: unknown }).message
      : null;
  if (typeof message !== "string" || !STABLE_DATABASE_ERRORS.has(message)) return null;
  return {
    ok: false as const,
    error: { code: message, message: "Falcon24 验收状态门禁拒绝当前操作。", retryable: false },
  };
}

function exact(rows: readonly JsonRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
      "Falcon24 Campaign RPC 必须返回恰好一行。",
    );
  }
  return rows[0]?.value;
}

async function commandWithHash<T extends Record<string, unknown>>(command: T) {
  return { ...command, command_hash: await sha256ContentHash(command) } as const;
}

function assertCampaignIdentity(
  campaign: z.infer<typeof campaignRowSchema>,
  expected: { readonly campaign_id: string },
) {
  if (campaign.campaign_id !== expected.campaign_id) {
    throw new PersistenceBoundaryError(
      "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
      "Falcon24 Campaign RPC 返回了不同的 Campaign。",
    );
  }
  return campaign;
}

export function createPostgresFalcon24AcceptanceCampaignAuthority(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  return Object.freeze({
    async load(capabilityInput: unknown, candidate: { readonly campaign_id: unknown }) {
      const request = z.strictObject({ campaign_id: campaignIdSchema }).parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-campaign-load@1.0.0" as const,
        campaign_id: request.campaign_id,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-campaign",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_acceptance_campaign($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          return assertCampaignIdentity(campaignRowSchema.parse(raw), request);
        },
      );
    },

    async loadRun(capabilityInput: unknown, candidate: unknown) {
      const request = runIdentityInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-campaign-run-load@1.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-run",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_acceptance_campaign_run($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          const run = campaignRunRowSchema.parse(raw);
          if (run.campaign_id !== request.campaign_id || run.run_id !== request.run_id) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Run escaped its exact campaign/run identity.",
            );
          }
          return run;
        },
      );
    },

    async loadPendingFailedRun(capabilityInput: unknown) {
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-pending-failed-run",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_pending_failed_run() as value",
          );
          const raw = exact(result.rows);
          return raw === null ? null : pendingFailedRunSchema.parse(raw);
        },
      );
    },

    async begin(capabilityInput: unknown, candidate: unknown) {
      const manifest = falcon24AcceptanceRunManifestSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-campaign-begin@1.0.0" as const,
        manifest,
        policy_id: CAMPAIGN_POLICY_ID,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.begin",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.begin_falcon24_acceptance_campaign($1::jsonb) as value",
            [command],
          );
          const campaign = campaignRowSchema.parse(exact(result.rows));
          if (
            campaign.campaign_version !== manifest.campaign_version ||
            campaign.source_fingerprint !== manifest.source_fingerprint ||
            campaign.frozen_contract_hash !== manifest.frozen_contract_hash ||
            campaign.runtime_attestation_hash !== manifest.runtime_attestation_hash ||
            campaign.manifest_hash !== manifest.manifest_hash
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Campaign RPC 返回的冻结身份与请求不一致。",
            );
          }
          return assertCampaignIdentity(campaign, manifest);
        },
      );
    },

    async claim(capabilityInput: unknown, candidate: unknown) {
      const request = claimInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-run-claim@2.0.0" as const,
        ...request,
      });
      const expectedFenceHash = await sha256ContentHash({
        claim_fence_token: request.claim_fence_token,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.claim",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.claim_falcon24_acceptance_run($1::jsonb) as value",
            [command],
          );
          const run = campaignRunRowSchema.parse(exact(result.rows));
          if (
            run.campaign_id !== request.campaign_id ||
            run.run_id !== request.run_id ||
            run.run_ordinal !== request.run_ordinal ||
            run.case_id !== request.case_id ||
            run.run_variant !== request.run_variant ||
            run.repetition !== request.repetition ||
            run.status !== "CLAIMED" ||
            run.claim_fence_hash !== expectedFenceHash ||
            run.claim_fence_consumed_at !== null
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Run claim RPC 返回了不同的运行身份。",
            );
          }
          return run;
        },
      );
    },

    async hold(capabilityInput: unknown, candidate: unknown) {
      const request = holdInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-campaign-hold@2.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.hold",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.hold_falcon24_acceptance_campaign($1::jsonb) as value",
            [command],
          );
          const campaign = assertCampaignIdentity(
            campaignRowSchema.parse(exact(result.rows)),
            request,
          );
          if (
            campaign.status !== "HOLD" ||
            campaign.first_failure_run_id !== request.run_id ||
            campaign.first_failure_layer !== request.failure_layer ||
            campaign.first_failure_code !== request.failure_code
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 HOLD RPC 未冻结当前首个失败。",
            );
          }
          return campaign;
        },
      );
    },

    async resolveSubmitOutcome(capabilityInput: unknown, candidate: unknown) {
      const request = submitOutcomeInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-submit-outcome-resolution@1.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.resolve-submit-outcome",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.resolve_falcon24_acceptance_submit_outcome($1::jsonb) as value",
            [command],
          );
          const resolution = submitOutcomeResolutionSchema.parse(exact(result.rows));
          if (
            resolution.campaign_id !== request.campaign_id ||
            resolution.run_id !== request.run_id
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 submit outcome RPC 返回了不同的运行身份。",
            );
          }
          return resolution;
        },
      );
    },

    async stage(capabilityInput: unknown, candidate: unknown) {
      const request = stageInputSchema.parse(candidate);
      if (request.result_document.run_id !== request.run_id) {
        throw new TypeError("FALCON24_RESULT_STAGE_IDENTITY_INVALID");
      }
      const resultHash = await sha256ContentHash(request.result_document);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-result-stage@1.0.0" as const,
        campaign_id: request.campaign_id,
        run_id: request.run_id,
        result_hash: resultHash,
        result_document: request.result_document,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.stage-result",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.stage_falcon24_acceptance_result($1::jsonb) as value",
            [command],
          );
          const campaignRun = campaignRunRowSchema.parse(exact(result.rows));
          if (
            campaignRun.campaign_id !== request.campaign_id ||
            campaignRun.run_id !== request.run_id ||
            campaignRun.status !== "CLAIMED" ||
            campaignRun.claim_fence_hash === null ||
            campaignRun.claim_fence_consumed_at === null ||
            campaignRun.result_hash !== resultHash ||
            campaignRun.result_document?.run_id !== request.run_id
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 staged result RPC 返回了不同的运行证据。",
            );
          }
          return campaignRun;
        },
      );
    },

    async stageTrace(capabilityInput: unknown, candidate: unknown) {
      const request = traceStageInputSchema.parse(candidate);
      const receipt = await verifyFalcon24ResolutionTraceGateReceipt(request.receipt);
      if (receipt.campaign_id !== request.campaign_id || receipt.run_id !== request.run_id) {
        throw new TypeError("FALCON24_TRACE_STAGE_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-trace-stage@1.0.0" as const,
        campaign_id: request.campaign_id,
        run_id: request.run_id,
        trace_closure_hash: receipt.trace_hash,
        trace_gate_receipt_hash: receipt.receipt_hash,
        trace_gate_receipt: receipt,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.stage-trace",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.stage_falcon24_acceptance_trace($1::jsonb) as value",
            [command],
          );
          const campaignRun = campaignRunRowSchema.parse(exact(result.rows));
          if (
            campaignRun.campaign_id !== request.campaign_id ||
            campaignRun.run_id !== request.run_id ||
            campaignRun.status !== "CLAIMED" ||
            campaignRun.claim_fence_hash === null ||
            campaignRun.claim_fence_consumed_at === null ||
            campaignRun.trace_closure_hash !== receipt.trace_hash ||
            campaignRun.trace_gate_receipt_hash !== receipt.receipt_hash ||
            campaignRun.trace_gate_receipt?.receipt_hash !== receipt.receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Trace stage RPC 返回了不同的轨迹闭包。",
            );
          }
          return campaignRun;
        },
      );
    },

    async loadTraceGate(capabilityInput: unknown, candidate: unknown) {
      const request = runIdentityInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-trace-gate-load@1.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-trace-gate",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_acceptance_trace_gate($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          const receipt = await verifyFalcon24ResolutionTraceGateReceipt(raw);
          if (receipt.campaign_id !== request.campaign_id || receipt.run_id !== request.run_id) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Trace gate receipt escaped its exact campaign/run identity.",
            );
          }
          return receipt;
        },
      );
    },

    async stageUiTrace(capabilityInput: unknown, candidate: unknown) {
      const request = uiTraceStageInputSchema.parse(candidate);
      const receipt = await verifyFalcon24ResolutionTraceUiGateReceipt(request.receipt);
      if (receipt.campaign_id !== request.campaign_id || receipt.run_id !== request.run_id) {
        throw new TypeError("FALCON24_UI_TRACE_STAGE_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-ui-trace-stage@1.0.0" as const,
        campaign_id: request.campaign_id,
        run_id: request.run_id,
        trace_closure_hash: receipt.trace_hash,
        ui_trace_gate_receipt_hash: receipt.receipt_hash,
        ui_trace_gate_receipt: receipt,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.stage-ui-trace",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.stage_falcon24_acceptance_ui_trace($1::jsonb) as value",
            [command],
          );
          const campaignRun = campaignRunRowSchema.parse(exact(result.rows));
          if (
            campaignRun.campaign_id !== request.campaign_id ||
            campaignRun.run_id !== request.run_id ||
            campaignRun.status !== "CLAIMED" ||
            campaignRun.trace_closure_hash !== receipt.trace_hash ||
            campaignRun.ui_trace_gate_receipt_hash !== receipt.receipt_hash ||
            campaignRun.ui_trace_gate_receipt?.receipt_hash !== receipt.receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 UI Trace stage RPC 返回了不同的浏览器闭包。",
            );
          }
          return campaignRun;
        },
      );
    },

    async loadUiTraceGate(capabilityInput: unknown, candidate: unknown) {
      const request = runIdentityInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-ui-trace-gate-load@1.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-ui-trace-gate",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_acceptance_ui_trace_gate($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          const receipt = await verifyFalcon24ResolutionTraceUiGateReceipt(raw);
          if (receipt.campaign_id !== request.campaign_id || receipt.run_id !== request.run_id) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 UI Trace gate receipt escaped its exact campaign/run identity.",
            );
          }
          return receipt;
        },
      );
    },

    async claimSandboxReclamation(capabilityInput: unknown, candidate: unknown) {
      const request = reclamationClaimInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-sandbox-reclamation-claim@1.0.0" as const,
        ...request,
      });
      const expectedClaimHash = await sha256ContentHash({
        reclamation_claim_token: request.reclamation_claim_token,
      });
      const expectedRecoveryHash = await sha256ContentHash({
        reclamation_recovery_token: request.reclamation_recovery_token,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.claim-sandbox-reclamation",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.claim_falcon24_sandbox_reclamation($1::jsonb) as value",
            [command],
          );
          const campaignRun = campaignRunRowSchema.parse(exact(result.rows));
          if (
            campaignRun.campaign_id !== request.campaign_id ||
            campaignRun.run_id !== request.run_id
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Sandbox reclamation claim escaped its exact identity.",
            );
          }
          if (campaignRun.sandbox_reclamation_receipt !== null) {
            const receipt = await verifyFalcon24SandboxReclamationReceipt(
              campaignRun.sandbox_reclamation_receipt,
            );
            if (
              receipt.campaign_id !== request.campaign_id ||
              receipt.run_id !== request.run_id ||
              campaignRun.sandbox_reclamation_hash !== receipt.receipt_hash ||
              campaignRun.sandbox_reclamation_recovery_hash !== expectedRecoveryHash ||
              campaignRun.sandbox_reclamation_claim_hash === null ||
              campaignRun.sandbox_reclamation_claimed_at === null ||
              campaignRun.sandbox_reclamation_claim_expires_at === null ||
              campaignRun.sandbox_reclamation_claim_consumed_at === null
            ) {
              throw new PersistenceBoundaryError(
                "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
                "Falcon24 completed Sandbox reclamation claim is not durably closed.",
              );
            }
            return { disposition: "COMPLETED" as const, receipt };
          }
          if (
            campaignRun.status !== "CLAIMED" ||
            campaignRun.claim_fence_hash === null ||
            campaignRun.claim_fence_consumed_at === null ||
            campaignRun.trace_closure_hash === null ||
            campaignRun.trace_gate_receipt_hash === null ||
            campaignRun.trace_gate_receipt === null ||
            campaignRun.sandbox_reclamation_recovery_hash !== expectedRecoveryHash ||
            campaignRun.sandbox_reclamation_claim_hash !== expectedClaimHash ||
            campaignRun.sandbox_reclamation_claimed_at === null ||
            campaignRun.sandbox_reclamation_claim_expires_at === null ||
            campaignRun.sandbox_reclamation_claim_consumed_at !== null ||
            campaignRun.sandbox_reclamation_hash !== null
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Sandbox reclamation claim was not atomically persisted.",
            );
          }
          return { disposition: "CLAIMED" as const, receipt: null };
        },
      );
    },

    async complete(capabilityInput: unknown, candidate: unknown) {
      const request = completeInputSchema.parse(candidate);
      if (request.result_document.run_id !== request.run_id) {
        throw new TypeError("FALCON24_RUN_COMPLETION_IDENTITY_INVALID");
      }
      const resultHash = await sha256ContentHash(request.result_document);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-run-complete@2.0.0" as const,
        campaign_id: request.campaign_id,
        run_id: request.run_id,
        expected_result_hash: resultHash,
        sandbox_reclamation_hash: request.sandbox_reclamation_hash,
      });
      const completed = await withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.complete",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.complete_falcon24_acceptance_run($1::jsonb) as value",
            [command],
          );
          const campaign = assertCampaignIdentity(
            campaignRowSchema.parse(exact(result.rows)),
            request,
          );
          if (campaign.status !== "READY" && campaign.status !== "PASSED") {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 completion RPC 未推进到可验证状态。",
            );
          }
          return campaign;
        },
      );
      if (completed.ok || completed.error.code !== "PERSISTENCE_TRANSACTION_FAILED") {
        return completed;
      }

      const [loadRunCommand, loadCampaignCommand] = await Promise.all([
        commandWithHash({
          schema_version: "falcon24-acceptance-campaign-run-load@1.0.0" as const,
          campaign_id: request.campaign_id,
          run_id: request.run_id,
        }),
        commandWithHash({
          schema_version: "falcon24-acceptance-campaign-load@1.0.0" as const,
          campaign_id: request.campaign_id,
        }),
      ]);
      const recovered = await withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.complete-recover",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const [runResult, campaignResult] = await Promise.all([
            client.query<JsonRow>(
              "select app_data_agent.load_falcon24_acceptance_campaign_run($1::jsonb) as value",
              [loadRunCommand],
            ),
            client.query<JsonRow>(
              "select app_data_agent.load_falcon24_acceptance_campaign($1::jsonb) as value",
              [loadCampaignCommand],
            ),
          ]);
          const campaignRun = campaignRunRowSchema.parse(exact(runResult.rows));
          const campaign = assertCampaignIdentity(
            campaignRowSchema.parse(exact(campaignResult.rows)),
            request,
          );
          if (
            campaignRun.campaign_id !== request.campaign_id ||
            campaignRun.run_id !== request.run_id
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 completion recovery escaped its exact identity.",
            );
          }
          return { campaign, campaign_run: campaignRun } as const;
        },
      );
      if (!recovered.ok) {
        return {
          ok: false as const,
          error: {
            code: "FALCON24_FINALIZE_OUTCOME_UNKNOWN",
            message: "Falcon24 finalize 提交结果未知，必须先从 PostgreSQL 权威恢复。",
            retryable: false,
          },
        };
      }
      if (
        recovered.value.campaign_run.status === "VERIFIED" &&
        recovered.value.campaign_run.result_hash === resultHash &&
        recovered.value.campaign_run.sandbox_reclamation_hash ===
          request.sandbox_reclamation_hash &&
        recovered.value.campaign_run.trace_closure_hash !== null &&
        recovered.value.campaign_run.trace_gate_receipt_hash !== null &&
        recovered.value.campaign_run.trace_gate_receipt !== null &&
        (recovered.value.campaign.status === "READY" ||
          recovered.value.campaign.status === "PASSED")
      ) {
        return { ok: true as const, value: recovered.value.campaign };
      }
      if (recovered.value.campaign_run.status === "CLAIMED") return completed;
      return {
        ok: false as const,
        error: {
          code: "FALCON24_FINALIZE_OUTCOME_UNKNOWN",
          message: "Falcon24 finalize 权威状态与提交命令不一致。",
          retryable: false,
        },
      };
    },

    async recordSandboxReclamation(capabilityInput: unknown, candidate: unknown) {
      const request = reclamationRecordInputSchema.parse(candidate);
      const receipt = await verifyFalcon24SandboxReclamationReceipt(request.receipt);
      if (receipt.campaign_id !== request.campaign_id || receipt.run_id !== request.run_id) {
        throw new TypeError("FALCON24_SANDBOX_RECLAMATION_IDENTITY_INVALID");
      }
      const command = await commandWithHash({
        schema_version: "falcon24-sandbox-reclamation-record@1.0.0" as const,
        campaign_id: request.campaign_id,
        run_id: request.run_id,
        reclamation_claim_token: request.reclamation_claim_token,
        sandbox_reclamation_hash: receipt.receipt_hash,
        sandbox_reclamation_receipt: receipt,
      });
      const expectedClaimHash = await sha256ContentHash({
        reclamation_claim_token: request.reclamation_claim_token,
      });
      const recorded = await withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.record-sandbox-reclamation",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.record_falcon24_sandbox_reclamation($1::jsonb) as value",
            [command],
          );
          const campaignRun = campaignRunRowSchema.parse(exact(result.rows));
          if (
            campaignRun.campaign_id !== request.campaign_id ||
            campaignRun.run_id !== request.run_id ||
            campaignRun.status !== "CLAIMED" ||
            campaignRun.claim_fence_hash === null ||
            campaignRun.claim_fence_consumed_at === null ||
            campaignRun.trace_closure_hash === null ||
            campaignRun.trace_gate_receipt_hash === null ||
            campaignRun.trace_gate_receipt === null ||
            campaignRun.sandbox_reclamation_claim_hash !== expectedClaimHash ||
            campaignRun.sandbox_reclamation_claimed_at === null ||
            campaignRun.sandbox_reclamation_claim_expires_at === null ||
            campaignRun.sandbox_reclamation_claim_consumed_at === null ||
            campaignRun.sandbox_reclamation_hash !== receipt.receipt_hash ||
            campaignRun.sandbox_reclamation_receipt?.receipt_hash !== receipt.receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Sandbox reclamation RPC 返回了不同的管理面凭据。",
            );
          }
          return campaignRun;
        },
      );
      if (recorded.ok || recorded.error.code !== "PERSISTENCE_TRANSACTION_FAILED") {
        return recorded;
      }

      const loadCommand = await commandWithHash({
        schema_version: "falcon24-acceptance-campaign-run-load@1.0.0" as const,
        campaign_id: request.campaign_id,
        run_id: request.run_id,
      });
      const recovered = await withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.record-sandbox-reclamation-recover",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_acceptance_campaign_run($1::jsonb) as value",
            [loadCommand],
          );
          return campaignRunRowSchema.parse(exact(result.rows));
        },
      );
      if (!recovered.ok) {
        return {
          ok: false as const,
          error: {
            code: "FALCON24_SANDBOX_RECLAMATION_OUTCOME_UNKNOWN",
            message: "Falcon24 Sandbox 回收提交结果未知，必须先从 PostgreSQL 权威恢复。",
            retryable: false,
          },
        };
      }
      const recoveredRun = recovered.value;
      if (
        recoveredRun.campaign_id !== request.campaign_id ||
        recoveredRun.run_id !== request.run_id
      ) {
        return {
          ok: false as const,
          error: {
            code: "FALCON24_SANDBOX_RECLAMATION_OUTCOME_UNKNOWN",
            message: "Falcon24 Sandbox 回收恢复越过 exact campaign/run identity。",
            retryable: false,
          },
        };
      }
      if (
        recoveredRun.sandbox_reclamation_claim_hash === expectedClaimHash &&
        recoveredRun.sandbox_reclamation_claim_consumed_at !== null &&
        recoveredRun.sandbox_reclamation_hash === receipt.receipt_hash &&
        recoveredRun.sandbox_reclamation_receipt?.receipt_hash === receipt.receipt_hash
      ) {
        return { ok: true as const, value: recoveredRun };
      }
      if (
        recoveredRun.status === "CLAIMED" &&
        recoveredRun.sandbox_reclamation_claim_hash === expectedClaimHash &&
        recoveredRun.sandbox_reclamation_claim_consumed_at === null &&
        recoveredRun.sandbox_reclamation_hash === null &&
        recoveredRun.sandbox_reclamation_receipt === null
      ) {
        return recorded;
      }
      return {
        ok: false as const,
        error: {
          code: "FALCON24_SANDBOX_RECLAMATION_OUTCOME_UNKNOWN",
          message: "Falcon24 Sandbox 回收权威状态与提交命令不一致。",
          retryable: false,
        },
      };
    },

    async loadSandboxReclamation(capabilityInput: unknown, candidate: unknown) {
      const request = runIdentityInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-sandbox-reclamation-load@1.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-sandbox-reclamation",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_sandbox_reclamation($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          const receipt = await verifyFalcon24SandboxReclamationReceipt(raw);
          if (receipt.campaign_id !== request.campaign_id || receipt.run_id !== request.run_id) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 Sandbox reclamation receipt escaped its exact campaign/run identity.",
            );
          }
          return receipt;
        },
      );
    },

    async loadRunResult(
      capabilityInput: unknown,
      candidate: { readonly campaign_id: unknown; readonly run_id: unknown },
    ) {
      const request = runIdentityInputSchema.parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-run-result-load@1.0.0" as const,
        ...request,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-run-result",
          correlation_id: request.run_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_acceptance_run_result($1::jsonb) as value",
            [command],
          );
          const raw = exact(result.rows);
          if (raw === null) return null;
          const document = falcon24AgentAnalysisRunResultSchema.parse(raw);
          if (document.run_id !== request.run_id) {
            throw new PersistenceBoundaryError(
              "FALCON24_CAMPAIGN_DATABASE_CONTRACT_INVALID",
              "Falcon24 staged result escaped its exact run identity.",
            );
          }
          return document;
        },
      );
    },

    async loadVerifiedResults(
      capabilityInput: unknown,
      candidate: { readonly campaign_id: unknown },
    ) {
      const request = z.strictObject({ campaign_id: campaignIdSchema }).parse(candidate);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-results-load@1.0.0" as const,
        campaign_id: request.campaign_id,
      });
      return withAppTransaction(
        input.pool,
        input.authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "falcon24-acceptance.load-results",
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const result = await client.query<JsonRow>(
            "select app_data_agent.load_falcon24_acceptance_results($1::jsonb) as value",
            [command],
          );
          return z.array(falcon24AgentAnalysisRunResultSchema).max(30).parse(exact(result.rows));
        },
      );
    },
  });
}

export type PostgresFalcon24AcceptanceCampaignAuthority = ReturnType<
  typeof createPostgresFalcon24AcceptanceCampaignAuthority
>;
