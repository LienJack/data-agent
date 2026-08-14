import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/primitives.js";

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
export type CreditAccount = z.infer<typeof creditAccountSchema>;
export type CreditLedgerEntry = z.infer<typeof creditLedgerEntrySchema>;
export type CreditHold = z.infer<typeof creditHoldSchema>;
export type ModelBill = z.infer<typeof modelBillSchema>;
