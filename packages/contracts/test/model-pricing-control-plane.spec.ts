import { describe, expect, it } from "vitest";
import {
  modelCatalogEntrySchema,
  pricingCandidateDecisionInputSchema,
  submitFxRateSyncInputSchema,
  submitModelPriceSyncInputSchema,
} from "../src/index.js";

const ids = Array.from(
  { length: 8 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const evidenceHash = `sha256:${"a".repeat(64)}`;

describe("model pricing control-plane contracts", () => {
  it("projects model credentials as an opaque SecretRef", () => {
    const result = modelCatalogEntrySchema.parse({
      schema_version: "model-catalog-entry@1.0.0",
      app_id: ids[0],
      environment: "development",
      model_profile_id: ids[1],
      provider: "openai",
      model_id: "gpt-example",
      display_name: "Example",
      base_url: "https://api.openai.com/v1",
      capabilities: {
        structured_output: true,
        tool_calling: true,
        streaming: true,
        reasoning: true,
        vision: false,
      },
      credential_ref: {
        schema_version: "global-model-credential-ref@1.0.0",
        app_id: ids[0],
        environment: "development",
        credential_ref_id: ids[2],
        secret_ref_id: ids[3],
        secret_version: 1,
        rotation_state: "ACTIVE",
      },
      status: "ACTIVE",
      config_version: 1,
      is_system_default: true,
      created_by: ids[4],
      created_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("api_key");
  });

  it("keeps evidence bounded and preserves cache pricing dimensions", () => {
    const parsed = submitModelPriceSyncInputSchema.parse({
      schema_version: "model-price-sync-submit@1.0.0",
      operation_id: ids[0],
      source_adapter: "openai-pricing@1.0.0",
      source_url: "https://openai.com/api/pricing/",
      evidence_hash: evidenceHash,
      parser_version: "openai-pricing@1.0.0",
      fetched_at: "2026-08-14T00:00:00.000Z",
      raw_evidence: "official fixture",
      candidates: [
        {
          candidate_id: ids[1],
          provider: "openai",
          model_id: "gpt-example",
          risk: "NORMAL",
          components: [
            {
              component_id: ids[2],
              kind: "CACHE_READ_TOKENS",
              unit: "PER_MILLION_TOKENS",
              unit_price: "0.125",
              currency: "USD",
              tier_min_inclusive: "0",
              tier_max_exclusive: null,
            },
          ],
        },
      ],
    });
    expect(parsed.candidates[0]?.components[0]?.kind).toBe("CACHE_READ_TOKENS");
    expect(
      submitModelPriceSyncInputSchema.safeParse({ ...parsed, raw_evidence: "x".repeat(65_537) })
        .success,
    ).toBe(false);
  });

  it("rejects zero FX while allowing a rejection without an effective time", () => {
    const base = {
      schema_version: "fx-rate-sync-submit@1.0.0",
      operation_id: ids[0],
      source_adapter: "cfets@1.0.0",
      source_url: "https://www.chinamoney.com.cn/",
      evidence_hash: evidenceHash,
      parser_version: "cfets@1.0.0",
      fetched_at: "2026-08-14T00:00:00.000Z",
      raw_evidence: "fixture",
      candidates: [
        {
          candidate_id: ids[1],
          base_currency: "USD",
          quote_currency: "CNY",
          rate: "0",
          official_date: "2026-08-14",
        },
      ],
    };
    expect(submitFxRateSyncInputSchema.safeParse(base).success).toBe(false);
    expect(
      pricingCandidateDecisionInputSchema.parse({
        schema_version: "pricing-candidate-decision@1.0.0",
        operation_id: ids[2],
        idempotency_key: "reject-example",
        candidate_id: ids[1],
        decision: "REJECT",
        reason: "official evidence is incomplete",
        effective_from: null,
      }).decision,
    ).toBe("REJECT");
  });
});
