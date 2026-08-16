import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/primitives.js";
import { modelCapabilitiesSchema, modelProviderSchema } from "../providers/index.js";

export const decimalStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/, "必须使用非负十进制定点字符串");
export const signedIntegerStringSchema = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/, "必须使用规范整数字符串");
export const nonNegativeIntegerStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "必须使用非负规范整数字符串");
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const priceComponentKindSchema = z.enum([
  "INPUT_TOKENS",
  "OUTPUT_TOKENS",
  "CACHE_READ_TOKENS",
  "CACHE_WRITE_TOKENS",
  "TOOL_CALLS",
]);
export const priceUnitSchema = z.enum(["PER_MILLION_TOKENS", "PER_THOUSAND_TOKENS", "PER_CALL"]);

export const modelPriceComponentSchema = z.strictObject({
  component_id: immutableIdSchema,
  kind: priceComponentKindSchema,
  unit: priceUnitSchema,
  unit_price: decimalStringSchema,
  currency: currencyCodeSchema,
  tier_min_inclusive: nonNegativeIntegerStringSchema.nullable(),
  tier_max_exclusive: nonNegativeIntegerStringSchema.nullable(),
});

export const globalModelCredentialRefSchema = z.strictObject({
  schema_version: z.literal("global-model-credential-ref@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  credential_ref_id: immutableIdSchema,
  secret_ref_id: immutableIdSchema,
  secret_version: z.number().int().positive(),
  rotation_state: z.enum(["ACTIVE", "ROTATION_PENDING", "REVOCATION_PENDING", "REVOKED"]),
});

export const modelVendorIdSchema = z.enum([
  "deepseek",
  "kimi",
  "glm",
  "openai",
  "anthropic",
  "grok",
  "gemini",
  "volcengine",
  "siliconflow",
  "openai-compatible",
]);

export const modelProviderConnectionSourceSchema = z.enum(["environment", "manual"]);
export const modelProviderConnectionStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const modelProviderConnectionHealthSchema = z.enum([
  "configured",
  "untested",
  "connected",
  "failed",
]);

export const modelProviderConnectionSchema = z.strictObject({
  schema_version: z.literal("model-provider-connection@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  provider_connection_id: immutableIdSchema,
  vendor_id: modelVendorIdSchema,
  runtime_provider: modelProviderSchema,
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  credential_ref: globalModelCredentialRefSchema.nullable(),
  source: modelProviderConnectionSourceSchema,
  status: modelProviderConnectionStatusSchema,
  health: modelProviderConnectionHealthSchema,
  config_version: z.number().int().positive(),
  created_by: immutableIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const upsertModelProviderConnectionInputSchema = z.strictObject({
  schema_version: z.literal("model-provider-upsert@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  provider_connection_id: immutableIdSchema,
  vendor_id: modelVendorIdSchema,
  runtime_provider: modelProviderSchema,
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  credential_ref: globalModelCredentialRefSchema.nullable(),
  expected_config_version: z.number().int().nonnegative(),
});

export const archiveModelProviderConnectionInputSchema = z.strictObject({
  schema_version: z.literal("model-provider-archive@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  provider_connection_id: immutableIdSchema,
  expected_config_version: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export const modelProviderSelectionItemSchema = z.strictObject({
  model_profile_id: immutableIdSchema,
  model_id: z.string().min(1).max(256),
  display_name: z.string().min(1).max(255),
  capabilities: modelCapabilitiesSchema,
  enabled: z.boolean(),
  expected_config_version: z.number().int().nonnegative(),
});

export const modelProviderSelectionInputSchema = z.strictObject({
  schema_version: z.literal("model-provider-selection@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  provider_connection_id: immutableIdSchema,
  expected_connection_version: z.number().int().positive(),
  models: z.array(modelProviderSelectionItemSchema).min(1).max(1000),
});

export const modelCatalogEntrySchema = z.strictObject({
  schema_version: z.literal("model-catalog-entry@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  model_profile_id: immutableIdSchema,
  provider_connection_id: immutableIdSchema.optional(),
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  capabilities: modelCapabilitiesSchema,
  credential_ref: globalModelCredentialRefSchema.nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED", "UNBILLABLE"]),
  config_version: z.number().int().positive(),
  is_system_default: z.boolean(),
  created_by: immutableIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const upsertModelCatalogEntryInputSchema = z.strictObject({
  schema_version: z.literal("model-catalog-upsert@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  model_profile_id: immutableIdSchema,
  provider_connection_id: immutableIdSchema.optional(),
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  display_name: z.string().min(1).max(255),
  base_url: z.url().max(2048),
  capabilities: modelCapabilitiesSchema,
  credential_ref: globalModelCredentialRefSchema.nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED", "UNBILLABLE"]),
  is_system_default: z.boolean().default(false),
  expected_config_version: z.number().int().nonnegative(),
});

export const modelCatalogStatusInputSchema = z.strictObject({
  schema_version: z.literal("model-catalog-status@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  model_profile_id: immutableIdSchema,
  status: z.enum(["ACTIVE", "DISABLED", "UNBILLABLE"]),
  expected_config_version: z.number().int().positive(),
});

export const modelPriceCandidateSchema = z.strictObject({
  schema_version: z.literal("model-price-candidate@1.0.0"),
  candidate_id: immutableIdSchema,
  provider: z.string().min(1).max(64),
  model_id: z.string().min(1).max(256),
  status: z.enum(["FETCHED", "PARSED", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"]),
  source_url: z.url().max(2048),
  evidence_hash: contentHashSchema,
  parser_version: versionIdentifierSchema,
  fetched_at: timestampSchema,
  risk: z.enum(["NORMAL", "HIGH"]),
  components: z.array(modelPriceComponentSchema).min(1).max(32),
});

export const modelPriceVersionSchema = z.strictObject({
  schema_version: z.literal("model-price-version@1.0.0"),
  price_version_id: immutableIdSchema,
  source_candidate_id: immutableIdSchema,
  provider: z.string().min(1).max(64),
  model_id: z.string().min(1).max(256),
  components: z.array(modelPriceComponentSchema).min(1).max(32),
  approved_by: immutableIdSchema,
  approved_at: timestampSchema,
  effective_from: timestampSchema,
  effective_to: timestampSchema.nullable(),
});

export const fxRateCandidateSchema = z.strictObject({
  schema_version: z.literal("fx-rate-candidate@1.0.0"),
  candidate_id: immutableIdSchema,
  base_currency: currencyCodeSchema,
  quote_currency: currencyCodeSchema,
  rate: decimalStringSchema,
  official_date: z.iso.date(),
  source_url: z.url().max(2048),
  evidence_hash: contentHashSchema,
  parser_version: versionIdentifierSchema,
  fetched_at: timestampSchema,
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"]),
});

export const fxRateVersionSchema = z.strictObject({
  schema_version: z.literal("fx-rate-version@1.0.0"),
  fx_version_id: immutableIdSchema,
  source_candidate_id: immutableIdSchema,
  base_currency: currencyCodeSchema,
  quote_currency: currencyCodeSchema,
  rate: decimalStringSchema,
  approved_by: immutableIdSchema,
  approved_at: timestampSchema,
  effective_from: timestampSchema,
  effective_to: timestampSchema.nullable(),
});

export const pricingSyncOperationSchema = z.strictObject({
  schema_version: z.literal("pricing-sync-operation@1.0.0"),
  operation_id: immutableIdSchema,
  source_kind: z.enum(["MODEL_PRICE", "FX_RATE"]),
  source_adapter: versionIdentifierSchema,
  source_url: z.url().max(2048),
  evidence_hash: contentHashSchema.nullable(),
  parser_version: versionIdentifierSchema,
  status: z.enum(["SUCCEEDED", "FAILED"]),
  fetched_at: timestampSchema,
  raw_evidence_bytes: z.number().int().nonnegative().max(65_536),
  candidate_ids: z.array(immutableIdSchema).max(1_000),
  error_code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,127}$/)
    .nullable(),
});

const pricingSyncEvidenceSchema = {
  operation_id: immutableIdSchema,
  source_adapter: versionIdentifierSchema,
  source_url: z.url().max(2048),
  evidence_hash: contentHashSchema,
  parser_version: versionIdentifierSchema,
  fetched_at: timestampSchema,
  raw_evidence: z.string().max(65_536),
} as const;

export const submitModelPriceSyncInputSchema = z.strictObject({
  schema_version: z.literal("model-price-sync-submit@1.0.0"),
  ...pricingSyncEvidenceSchema,
  candidates: z
    .array(
      z.strictObject({
        candidate_id: immutableIdSchema,
        provider: modelProviderSchema,
        model_id: z.string().min(1).max(256),
        risk: z.enum(["NORMAL", "HIGH"]),
        components: z.array(modelPriceComponentSchema).min(1).max(32),
      }),
    )
    .min(1)
    .max(1_000),
});

export const submitFxRateSyncInputSchema = z.strictObject({
  schema_version: z.literal("fx-rate-sync-submit@1.0.0"),
  ...pricingSyncEvidenceSchema,
  candidates: z
    .array(
      z.strictObject({
        candidate_id: immutableIdSchema,
        base_currency: currencyCodeSchema,
        quote_currency: currencyCodeSchema,
        rate: decimalStringSchema.refine((rate) => rate !== "0", "汇率必须大于零"),
        official_date: z.iso.date(),
      }),
    )
    .min(1)
    .max(256),
});

export const pricingCandidateDecisionInputSchema = z
  .strictObject({
    schema_version: z.literal("pricing-candidate-decision@1.0.0"),
    operation_id: immutableIdSchema,
    idempotency_key: z.string().min(8).max(128),
    candidate_id: immutableIdSchema,
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().min(1).max(500),
    effective_from: timestampSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "APPROVE" && value.effective_from === null) {
      ctx.addIssue({
        code: "custom",
        path: ["effective_from"],
        message: "批准候选时必须指定生效时间",
      });
    }
  });

export const creditAccountSchema = z.strictObject({
  schema_version: z.literal("credit-account@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  principal_id: immutableIdSchema,
  settled_microcredits: nonNegativeIntegerStringSchema,
  active_held_microcredits: nonNegativeIntegerStringSchema,
  available_microcredits: nonNegativeIntegerStringSchema,
  version: z.number().int().min(1),
  updated_at: timestampSchema,
});

export const creditLedgerEntrySchema = z.strictObject({
  schema_version: z.literal("credit-ledger-entry@1.0.0"),
  entry_id: immutableIdSchema,
  app_id: immutableIdSchema,
  environment: environmentSchema,
  principal_id: immutableIdSchema,
  workspace_id: immutableIdSchema.nullable(),
  kind: z.enum(["GRANT", "ADJUSTMENT", "CHARGE", "REVERSAL"]),
  signed_microcredits: signedIntegerStringSchema,
  actor_principal_id: immutableIdSchema,
  reason: z.string().min(1).max(500),
  idempotency_key: z.string().min(8).max(128),
  balance_before_microcredits: nonNegativeIntegerStringSchema,
  balance_after_microcredits: nonNegativeIntegerStringSchema,
  account_version: z.number().int().positive(),
  created_at: timestampSchema,
});

export const creditHoldSchema = z.strictObject({
  schema_version: z.literal("credit-hold@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  hold_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  reserved_microcredits: nonNegativeIntegerStringSchema,
  state: z.enum(["ACTIVE", "SETTLED", "RELEASED", "REVIEW_REQUIRED"]),
  created_at: timestampSchema,
  closed_at: timestampSchema.nullable(),
});

export const creditAdjustmentInputSchema = z
  .strictObject({
    schema_version: z.literal("credit-adjustment@1.0.0"),
    operation_id: immutableIdSchema,
    idempotency_key: z.string().min(8).max(128),
    target_principal_id: immutableIdSchema,
    signed_microcredits: signedIntegerStringSchema,
    reason: z.string().min(1).max(500),
    expected_account_version: z.number().int().nonnegative(),
  })
  .refine((value) => value.signed_microcredits !== "0", {
    path: ["signed_microcredits"],
    message: "调账金额不能为零",
  });

export const creditHoldReservationInputSchema = z.strictObject({
  schema_version: z.literal("credit-hold-reserve@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  hold_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  reserved_microcredits: nonNegativeIntegerStringSchema.refine((value) => value !== "0", {
    message: "冻结金额必须大于零",
  }),
  expected_account_version: z.number().int().nonnegative(),
});

export const creditHoldReleaseInputSchema = z.strictObject({
  schema_version: z.literal("credit-hold-release@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  hold_id: immutableIdSchema,
  reason: z.string().min(1).max(500),
  expected_account_version: z.number().int().positive(),
});

export const creditProjectionRebuildInputSchema = z.strictObject({
  schema_version: z.literal("credit-projection-rebuild@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  target_principal_id: immutableIdSchema,
  reason: z.string().min(1).max(500),
  expected_account_version: z.number().int().positive(),
});

export const creditReconciliationReceiptSchema = z.strictObject({
  schema_version: z.literal("credit-reconciliation@1.0.0"),
  principal_id: immutableIdSchema,
  projected_settled_microcredits: nonNegativeIntegerStringSchema,
  ledger_settled_microcredits: nonNegativeIntegerStringSchema,
  projected_held_microcredits: nonNegativeIntegerStringSchema,
  active_holds_microcredits: nonNegativeIntegerStringSchema,
  consistent: z.boolean(),
  account_version: z.number().int().nonnegative(),
  checked_at: timestampSchema,
});

export const creditAdjustmentReceiptSchema = z.strictObject({
  operation_id: immutableIdSchema,
  account: creditAccountSchema,
});

export const creditHoldMutationReceiptSchema = z.strictObject({
  operation_id: immutableIdSchema,
  account: creditAccountSchema,
  hold: creditHoldSchema,
});

export const creditProjectionRebuildReceiptSchema = z.strictObject({
  operation_id: immutableIdSchema,
  changed: z.boolean(),
  account: creditAccountSchema,
});

export const billingAuditEntrySchema = z.strictObject({
  schema_version: z.literal("billing-audit-entry@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  audit_id: nonNegativeIntegerStringSchema,
  operation_id: immutableIdSchema,
  actor_principal_id: immutableIdSchema,
  target_principal_id: immutableIdSchema,
  action: z.enum(["ADJUST_CREDIT", "RESERVE_HOLD", "RELEASE_HOLD", "REBUILD_PROJECTION"]),
  reason: z.string().min(1).max(500),
  details: z.record(z.string(), z.unknown()),
  created_at: timestampSchema,
});

export const modelUsageSchema = z.strictObject({
  input_tokens: nonNegativeIntegerStringSchema,
  output_tokens: nonNegativeIntegerStringSchema,
  cache_read_tokens: nonNegativeIntegerStringSchema,
  cache_write_tokens: nonNegativeIntegerStringSchema,
  tool_calls: nonNegativeIntegerStringSchema,
});

export const modelBillSchema = z.strictObject({
  schema_version: z.literal("model-bill@1.0.0"),
  bill_id: immutableIdSchema,
  app_id: immutableIdSchema,
  environment: environmentSchema,
  principal_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  run_id: immutableIdSchema.nullable(),
  conversation_id: immutableIdSchema.nullable(),
  provider: z.string().min(1).max(64),
  model_id: z.string().min(1).max(256),
  funding_type: z.enum(["USER_CREDITS", "SYSTEM_FUNDED"]),
  state: z.enum(["RESERVED", "SETTLED", "RELEASED", "REVIEW_REQUIRED"]),
  price_version_id: immutableIdSchema,
  fx_version_id: immutableIdSchema.nullable(),
  official_currency: currencyCodeSchema,
  official_cost: decimalStringSchema,
  cny_cost: decimalStringSchema,
  charged_microcredits: nonNegativeIntegerStringSchema,
  usage: modelUsageSchema,
  formula_version: versionIdentifierSchema,
  created_at: timestampSchema,
  settled_at: timestampSchema.nullable(),
});

export const billingModeSchema = z.enum(["SHADOW", "ENFORCED"]);
export const modelBillFundingTypeSchema = z.enum(["USER_CREDITS", "SYSTEM_FUNDED"]);
export const modelBillStateSchema = z.enum(["RESERVED", "SETTLED", "RELEASED", "REVIEW_REQUIRED"]);

export const modelBillingBudgetSchema = z.strictObject({
  input_tokens: nonNegativeIntegerStringSchema,
  output_tokens: nonNegativeIntegerStringSchema,
  cache_read_tokens: nonNegativeIntegerStringSchema,
  cache_write_tokens: nonNegativeIntegerStringSchema,
  tool_calls: nonNegativeIntegerStringSchema,
});

export const modelBillPriceComponentSnapshotSchema = z.strictObject({
  component_id: immutableIdSchema,
  kind: priceComponentKindSchema,
  unit: priceUnitSchema,
  unit_price: decimalStringSchema,
  currency: currencyCodeSchema,
  tier_min_inclusive: nonNegativeIntegerStringSchema.nullable(),
  tier_max_exclusive: nonNegativeIntegerStringSchema.nullable(),
});

export const modelBillingAuthorizeInputSchema = z.strictObject({
  schema_version: z.literal("model-billing-authorize@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  bill_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  reservation_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  run_id: immutableIdSchema,
  conversation_id: immutableIdSchema.nullable(),
  datasource_id: immutableIdSchema,
  model_profile_id: immutableIdSchema,
  expected_model_config_version: z.number().int().positive(),
  request_budget: modelBillingBudgetSchema,
  expected_account_version: z.number().int().nonnegative(),
});

export const modelBillingFinalizeInputSchema = z
  .strictObject({
    schema_version: z.literal("model-billing-finalize@1.0.0"),
    operation_id: immutableIdSchema,
    idempotency_key: z.string().min(8).max(128),
    bill_id: immutableIdSchema,
    terminal_kind: z.enum([
      "COMPLETED",
      "FAILED_WITH_USAGE",
      "CANCELLED_BEFORE_START",
      "OUTCOME_UNKNOWN",
    ]),
    outcome_usage_record_id: immutableIdSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    const usageRequired =
      value.terminal_kind === "COMPLETED" || value.terminal_kind === "FAILED_WITH_USAGE";
    if (usageRequired !== (value.outcome_usage_record_id !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome_usage_record_id"],
        message: usageRequired ? "该终态必须绑定实际 usage" : "该终态不能伪造 usage 引用",
      });
    }
  });

export const modelBillingReviewInputSchema = z.strictObject({
  schema_version: z.literal("model-billing-review@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  bill_id: immutableIdSchema,
  decision: z.enum(["SETTLE_VERIFIED", "RELEASE"]),
  verified_usage: modelUsageSchema.nullable(),
  reason: z.string().min(1).max(500),
});

export const billingModeDecisionInputSchema = z.strictObject({
  schema_version: z.literal("billing-mode-decision@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z.string().min(8).max(128),
  target_mode: billingModeSchema,
  expected_epoch: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export const billingRuntimeStateSchema = z.strictObject({
  schema_version: z.literal("billing-runtime-state@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  deployment_id: immutableIdSchema,
  mode: billingModeSchema,
  epoch: z.number().int().positive(),
  approved_by: immutableIdSchema.nullable(),
  approved_at: timestampSchema.nullable(),
  updated_at: timestampSchema,
});

export const modelBillingBillSchema = z.strictObject({
  schema_version: z.literal("model-billing-bill@1.0.0"),
  bill_id: immutableIdSchema,
  app_id: immutableIdSchema,
  environment: environmentSchema,
  principal_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  reservation_id: immutableIdSchema,
  run_id: immutableIdSchema,
  conversation_id: immutableIdSchema.nullable(),
  datasource_id: immutableIdSchema,
  model_profile_id: immutableIdSchema,
  model_config_version: z.number().int().positive(),
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  funding_type: modelBillFundingTypeSchema,
  billing_mode: billingModeSchema,
  state: modelBillStateSchema,
  hold_id: immutableIdSchema.nullable(),
  price_version_id: immutableIdSchema,
  fx_version_id: immutableIdSchema.nullable(),
  official_currency: currencyCodeSchema,
  fx_rate: decimalStringSchema,
  request_budget: modelBillingBudgetSchema,
  reserved_microcredits: nonNegativeIntegerStringSchema,
  usage: modelUsageSchema.nullable(),
  official_cost: decimalStringSchema,
  cny_cost: decimalStringSchema,
  charged_microcredits: nonNegativeIntegerStringSchema,
  rounding_delta_microcredits: signedIntegerStringSchema,
  formula_version: z.literal("model-billing-formula@1.0.0"),
  review_reason: z.string().min(1).max(500).nullable(),
  created_at: timestampSchema,
  settled_at: timestampSchema.nullable(),
});

export const modelBillingAuthorizationReceiptSchema = z.strictObject({
  operation_id: immutableIdSchema,
  bill: modelBillingBillSchema,
  provider_call_allowed: z.boolean(),
  hold: creditHoldSchema.nullable(),
  account: creditAccountSchema.nullable(),
});

export const modelBillingTerminalReceiptSchema = z.strictObject({
  operation_id: immutableIdSchema,
  bill: modelBillingBillSchema,
  hold: creditHoldSchema.nullable(),
  account: creditAccountSchema.nullable(),
});

export const modelBillingCostSummarySchema = z.strictObject({
  schema_version: z.literal("model-billing-cost-summary@1.0.0"),
  workspace_id: immutableIdSchema,
  run_id: immutableIdSchema.nullable(),
  conversation_id: immutableIdSchema.nullable(),
  funding_type: modelBillFundingTypeSchema,
  bill_count: nonNegativeIntegerStringSchema,
  settled_count: nonNegativeIntegerStringSchema,
  review_count: nonNegativeIntegerStringSchema,
  cny_cost: decimalStringSchema,
  charged_microcredits: nonNegativeIntegerStringSchema,
});

export const billingReconciliationReceiptSchema = z.strictObject({
  schema_version: z.literal("model-billing-reconciliation@1.0.0"),
  mode: billingModeSchema,
  terminal_model_invocations: nonNegativeIntegerStringSchema,
  terminal_bills: nonNegativeIntegerStringSchema,
  missing_bills: nonNegativeIntegerStringSchema,
  duplicate_bills: nonNegativeIntegerStringSchema,
  open_review_findings: nonNegativeIntegerStringSchema,
  hold_ledger_mismatches: nonNegativeIntegerStringSchema,
  ready_for_enforced: z.boolean(),
  checked_at: timestampSchema,
});

export const billingModeDecisionReceiptSchema = z.strictObject({
  operation_id: immutableIdSchema,
  state: billingRuntimeStateSchema,
  reconciliation: billingReconciliationReceiptSchema,
});

export type ModelPriceCandidate = z.infer<typeof modelPriceCandidateSchema>;
export type ModelPriceVersion = z.infer<typeof modelPriceVersionSchema>;
export type FxRateCandidate = z.infer<typeof fxRateCandidateSchema>;
export type FxRateVersion = z.infer<typeof fxRateVersionSchema>;
export type GlobalModelCredentialRef = z.infer<typeof globalModelCredentialRefSchema>;
export type ModelVendorId = z.infer<typeof modelVendorIdSchema>;
export type ModelProviderConnection = z.infer<typeof modelProviderConnectionSchema>;
export type UpsertModelProviderConnectionInput = z.infer<
  typeof upsertModelProviderConnectionInputSchema
>;
export type ArchiveModelProviderConnectionInput = z.infer<
  typeof archiveModelProviderConnectionInputSchema
>;
export type ModelProviderSelectionInput = z.infer<typeof modelProviderSelectionInputSchema>;
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;
export type UpsertModelCatalogEntryInput = z.infer<typeof upsertModelCatalogEntryInputSchema>;
export type ModelCatalogStatusInput = z.infer<typeof modelCatalogStatusInputSchema>;
export type PricingSyncOperation = z.infer<typeof pricingSyncOperationSchema>;
export type SubmitModelPriceSyncInput = z.infer<typeof submitModelPriceSyncInputSchema>;
export type SubmitFxRateSyncInput = z.infer<typeof submitFxRateSyncInputSchema>;
export type PricingCandidateDecisionInput = z.infer<typeof pricingCandidateDecisionInputSchema>;
export type CreditAccount = z.infer<typeof creditAccountSchema>;
export type CreditLedgerEntry = z.infer<typeof creditLedgerEntrySchema>;
export type CreditHold = z.infer<typeof creditHoldSchema>;
export type CreditAdjustmentInput = z.infer<typeof creditAdjustmentInputSchema>;
export type CreditHoldReservationInput = z.infer<typeof creditHoldReservationInputSchema>;
export type CreditHoldReleaseInput = z.infer<typeof creditHoldReleaseInputSchema>;
export type CreditProjectionRebuildInput = z.infer<typeof creditProjectionRebuildInputSchema>;
export type CreditReconciliationReceipt = z.infer<typeof creditReconciliationReceiptSchema>;
export type CreditAdjustmentReceipt = z.infer<typeof creditAdjustmentReceiptSchema>;
export type CreditHoldMutationReceipt = z.infer<typeof creditHoldMutationReceiptSchema>;
export type CreditProjectionRebuildReceipt = z.infer<typeof creditProjectionRebuildReceiptSchema>;
export type BillingAuditEntry = z.infer<typeof billingAuditEntrySchema>;
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type ModelBill = z.infer<typeof modelBillSchema>;
export type BillingMode = z.infer<typeof billingModeSchema>;
export type ModelBillingBudget = z.infer<typeof modelBillingBudgetSchema>;
export type ModelBillPriceComponentSnapshot = z.infer<typeof modelBillPriceComponentSnapshotSchema>;
export type ModelBillingAuthorizeInput = z.infer<typeof modelBillingAuthorizeInputSchema>;
export type ModelBillingFinalizeInput = z.infer<typeof modelBillingFinalizeInputSchema>;
export type ModelBillingReviewInput = z.infer<typeof modelBillingReviewInputSchema>;
export type BillingModeDecisionInput = z.infer<typeof billingModeDecisionInputSchema>;
export type BillingRuntimeState = z.infer<typeof billingRuntimeStateSchema>;
export type ModelBillingBill = z.infer<typeof modelBillingBillSchema>;
export type ModelBillingAuthorizationReceipt = z.infer<
  typeof modelBillingAuthorizationReceiptSchema
>;
export type ModelBillingTerminalReceipt = z.infer<typeof modelBillingTerminalReceiptSchema>;
export type ModelBillingCostSummary = z.infer<typeof modelBillingCostSummarySchema>;
export type BillingReconciliationReceipt = z.infer<typeof billingReconciliationReceiptSchema>;
export type BillingModeDecisionReceipt = z.infer<typeof billingModeDecisionReceiptSchema>;
