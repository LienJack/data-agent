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
  rotation_state: z.enum([
    "ACTIVE",
    "ROTATION_PENDING",
    "REVOCATION_PENDING",
    "REVOKED",
  ]),
});

export const modelCatalogEntrySchema = z.strictObject({
  schema_version: z.literal("model-catalog-entry@1.0.0"),
  app_id: immutableIdSchema,
  environment: environmentSchema,
  model_profile_id: immutableIdSchema,
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
  error_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/).nullable(),
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
  created_at: timestampSchema,
});

export const creditHoldSchema = z.strictObject({
  schema_version: z.literal("credit-hold@1.0.0"),
  hold_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  reserved_microcredits: nonNegativeIntegerStringSchema,
  state: z.enum(["ACTIVE", "SETTLED", "RELEASED", "REVIEW_REQUIRED"]),
  created_at: timestampSchema,
  closed_at: timestampSchema.nullable(),
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

export type ModelPriceCandidate = z.infer<typeof modelPriceCandidateSchema>;
export type ModelPriceVersion = z.infer<typeof modelPriceVersionSchema>;
export type FxRateCandidate = z.infer<typeof fxRateCandidateSchema>;
export type FxRateVersion = z.infer<typeof fxRateVersionSchema>;
export type GlobalModelCredentialRef = z.infer<typeof globalModelCredentialRefSchema>;
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
export type ModelBill = z.infer<typeof modelBillSchema>;
