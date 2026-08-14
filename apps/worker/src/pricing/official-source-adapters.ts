import { createHash } from "node:crypto";
import {
  contentHashSchema,
  modelProviderSchema,
  priceComponentKindSchema,
  priceUnitSchema,
  type SubmitFxRateSyncInput,
  type SubmitModelPriceSyncInput,
  submitFxRateSyncInputSchema,
  submitModelPriceSyncInputSchema,
} from "@data-agent/contracts";
import { z } from "zod";

export const MAX_PRICING_EVIDENCE_BYTES = 65_536;

const fixtureComponentSchema = z.strictObject({
  kind: priceComponentKindSchema,
  unit: priceUnitSchema,
  unit_price: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  tier_min_inclusive: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .nullable(),
  tier_max_exclusive: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .nullable(),
});

const modelFixtureSchema = z.strictObject({
  schema_version: z.literal("official-model-pricing@1.0.0"),
  provider: modelProviderSchema,
  models: z
    .array(
      z.strictObject({
        model_id: z.string().min(1).max(256),
        risk: z.enum(["NORMAL", "HIGH"]),
        components: z.array(fixtureComponentSchema).min(1).max(32),
      }),
    )
    .min(1)
    .max(1_000),
});

const fxFixtureSchema = z.strictObject({
  schema_version: z.literal("official-fx-rates@1.0.0"),
  publisher: z.enum(["CFETS", "PBOC"]),
  rates: z
    .array(
      z.strictObject({
        base_currency: z.string().regex(/^[A-Z]{3}$/),
        quote_currency: z.literal("CNY"),
        rate: z.string().regex(/^(?!0(?:\.0+)?$)(0|[1-9][0-9]*)(\.[0-9]+)?$/),
        official_date: z.iso.date(),
      }),
    )
    .min(1)
    .max(256),
});

function evidenceHash(rawEvidence: string): `sha256:${string}` {
  return contentHashSchema.parse(
    `sha256:${createHash("sha256").update(rawEvidence, "utf8").digest("hex")}`,
  ) as `sha256:${string}`;
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertEvidenceSize(rawEvidence: string): void {
  if (Buffer.byteLength(rawEvidence, "utf8") > MAX_PRICING_EVIDENCE_BYTES) {
    throw new Error("PRICING_SOURCE_EVIDENCE_TOO_LARGE");
  }
}

export interface ModelPriceSourceAdapter {
  readonly kind: "MODEL_PRICE";
  readonly provider: z.infer<typeof modelProviderSchema>;
  readonly source_url: string;
  readonly adapter_version: string;
  parse(input: {
    readonly operation_id: string;
    readonly fetched_at: string;
    readonly raw_evidence: string;
  }): SubmitModelPriceSyncInput;
}

export interface FxRateSourceAdapter {
  readonly kind: "FX_RATE";
  readonly publisher: "CFETS" | "PBOC";
  readonly source_url: string;
  readonly adapter_version: string;
  parse(input: {
    readonly operation_id: string;
    readonly fetched_at: string;
    readonly raw_evidence: string;
  }): SubmitFxRateSyncInput;
}

function modelAdapter(
  provider: z.infer<typeof modelProviderSchema>,
  sourceUrl: string,
): ModelPriceSourceAdapter {
  const adapterVersion = `${provider}-official-pricing@1.0.0`;
  return Object.freeze({
    kind: "MODEL_PRICE" as const,
    provider,
    source_url: sourceUrl,
    adapter_version: adapterVersion,
    parse(input: {
      readonly operation_id: string;
      readonly fetched_at: string;
      readonly raw_evidence: string;
    }) {
      assertEvidenceSize(input.raw_evidence);
      const document = modelFixtureSchema.parse(JSON.parse(input.raw_evidence));
      if (document.provider !== provider) throw new Error("PRICING_SOURCE_PROVIDER_MISMATCH");
      const hash = evidenceHash(input.raw_evidence);
      return submitModelPriceSyncInputSchema.parse({
        schema_version: "model-price-sync-submit@1.0.0",
        operation_id: input.operation_id,
        source_adapter: adapterVersion,
        source_url: sourceUrl,
        evidence_hash: hash,
        parser_version: adapterVersion,
        fetched_at: input.fetched_at,
        raw_evidence: input.raw_evidence,
        candidates: document.models.map((model) => ({
          candidate_id: deterministicUuid(`${hash}:${provider}:${model.model_id}`),
          provider,
          model_id: model.model_id,
          risk: model.risk,
          components: model.components.map((component, index) => ({
            component_id: deterministicUuid(`${hash}:${provider}:${model.model_id}:${index}`),
            ...component,
          })),
        })),
      });
    },
  });
}

function fxAdapter(publisher: "CFETS" | "PBOC", sourceUrl: string): FxRateSourceAdapter {
  const adapterVersion = `${publisher.toLowerCase()}-official-fx@1.0.0`;
  return Object.freeze({
    kind: "FX_RATE" as const,
    publisher,
    source_url: sourceUrl,
    adapter_version: adapterVersion,
    parse(input: {
      readonly operation_id: string;
      readonly fetched_at: string;
      readonly raw_evidence: string;
    }) {
      assertEvidenceSize(input.raw_evidence);
      const document = fxFixtureSchema.parse(JSON.parse(input.raw_evidence));
      if (document.publisher !== publisher) throw new Error("FX_SOURCE_PUBLISHER_MISMATCH");
      const hash = evidenceHash(input.raw_evidence);
      return submitFxRateSyncInputSchema.parse({
        schema_version: "fx-rate-sync-submit@1.0.0",
        operation_id: input.operation_id,
        source_adapter: adapterVersion,
        source_url: sourceUrl,
        evidence_hash: hash,
        parser_version: adapterVersion,
        fetched_at: input.fetched_at,
        raw_evidence: input.raw_evidence,
        candidates: document.rates.map((rate) => ({
          candidate_id: deterministicUuid(
            `${hash}:${publisher}:${rate.base_currency}:${rate.quote_currency}:${rate.official_date}`,
          ),
          ...rate,
        })),
      });
    },
  });
}

export const OFFICIAL_MODEL_PRICE_ADAPTERS = Object.freeze([
  modelAdapter("openai", "https://openai.com/api/pricing/"),
  modelAdapter("anthropic", "https://platform.claude.com/docs/en/about-claude/pricing"),
  modelAdapter("gemini", "https://ai.google.dev/gemini-api/docs/pricing"),
  modelAdapter("deepseek", "https://api-docs.deepseek.com/quick_start/pricing"),
  modelAdapter("grok", "https://docs.x.ai/developers/rest-api-reference/inference/models"),
  modelAdapter("kimi", "https://platform.kimi.com/docs/pricing/chat-v1"),
  modelAdapter("glm", "https://docs.bigmodel.cn/cn/faq/fee-issues"),
]);

export const OFFICIAL_FX_RATE_ADAPTERS = Object.freeze([
  fxAdapter("CFETS", "https://www.chinamoney.com.cn/chinese/bkccpr/index.html?tab=2"),
  fxAdapter("PBOC", "https://www.pbc.gov.cn/zhengcehuobisi/125207/125217/125925/17105-2.html"),
]);

export type OfficialPricingSourceAdapter = ModelPriceSourceAdapter | FxRateSourceAdapter;
