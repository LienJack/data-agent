import { contentHashSchema, sha256ContentHash } from "@data-agent/contracts/common";
import {
  FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  falcon24AcceptanceCampaignIdSchema,
  falcon24AcceptanceFailureLayerSchema,
  falcon24AcceptanceRunManifestSchema,
  falcon24AgentAnalysisRunResultSchema,
  falcon24SandboxReclamationReceiptSchema,
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
  trace_closure_hash: contentHashSchema.nullable(),
  result_hash: contentHashSchema.nullable(),
  result_document: falcon24AgentAnalysisRunResultSchema.nullable(),
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
});

const holdInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  failure_layer: falcon24AcceptanceFailureLayerSchema,
  failure_code: failureCodeSchema,
});

const completeInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  trace_closure_hash: contentHashSchema,
  result_document: falcon24AgentAnalysisRunResultSchema,
  sandbox_reclamation_hash: contentHashSchema,
});
const stageInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  result_document: falcon24AgentAnalysisRunResultSchema,
});
const reclamationRecordInputSchema = z.strictObject({
  campaign_id: campaignIdSchema,
  run_id: canonicalImmutableIdSchema,
  receipt: falcon24SandboxReclamationReceiptSchema,
});
const runIdentityInputSchema = z.strictObject({
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
  "FALCON24_CAMPAIGN_HOLD",
  "FALCON24_RUN_ORDER_OR_STATE_INVALID",
  "FALCON24_RUN_SCHEDULE_MISMATCH",
  "FALCON24_RUN_ALREADY_CLAIMED",
  "FALCON24_CAMPAIGN_HOLD_INVALID",
  "FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH",
  "FALCON24_CAMPAIGN_ALREADY_PASSED",
  "FALCON24_RUN_NOT_CLAIMED",
  "FALCON24_RESULT_STAGE_INVALID",
  "FALCON24_RESULT_STAGE_REPLAY_MISMATCH",
  "FALCON24_ACTUAL_RUN_REQUIRED",
  "FALCON24_ACTUAL_RUN_NOT_SUCCEEDED",
  "FALCON24_RESULT_STAGE_REQUIRED",
  "FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID",
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
        schema_version: "falcon24-acceptance-run-claim@1.0.0" as const,
        ...request,
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
            run.status !== "CLAIMED"
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
        schema_version: "falcon24-acceptance-campaign-hold@1.0.0" as const,
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

    async complete(capabilityInput: unknown, candidate: unknown) {
      const request = completeInputSchema.parse(candidate);
      if (request.result_document.run_id !== request.run_id) {
        throw new TypeError("FALCON24_RUN_COMPLETION_IDENTITY_INVALID");
      }
      const resultHash = await sha256ContentHash(request.result_document);
      const command = await commandWithHash({
        schema_version: "falcon24-acceptance-run-complete@1.0.0" as const,
        campaign_id: request.campaign_id,
        run_id: request.run_id,
        trace_closure_hash: request.trace_closure_hash,
        expected_result_hash: resultHash,
        sandbox_reclamation_hash: request.sandbox_reclamation_hash,
      });
      return withAppTransaction(
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
        sandbox_reclamation_hash: receipt.receipt_hash,
        sandbox_reclamation_receipt: receipt,
      });
      return withAppTransaction(
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
