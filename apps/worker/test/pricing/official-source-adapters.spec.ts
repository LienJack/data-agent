import { describe, expect, it } from "vitest";
import {
  MAX_PRICING_EVIDENCE_BYTES,
  OFFICIAL_FX_RATE_ADAPTERS,
  OFFICIAL_MODEL_PRICE_ADAPTERS,
} from "../../src/pricing/official-source-adapters.js";

const operation = "00000000-0000-4000-8000-00000000a401";
const fetched = "2026-08-14T00:00:00.000Z";

describe("official pricing source adapters", () => {
  it("freezes seven provider-specific adapters and all price dimensions", () => {
    expect(OFFICIAL_MODEL_PRICE_ADAPTERS.map(({ provider }) => provider).sort()).toEqual([
      "anthropic",
      "deepseek",
      "gemini",
      "glm",
      "grok",
      "kimi",
      "openai",
    ]);
    for (const adapter of OFFICIAL_MODEL_PRICE_ADAPTERS) {
      const raw = JSON.stringify({
        schema_version: "official-model-pricing@1.0.0",
        provider: adapter.provider,
        models: [
          {
            model_id: `${adapter.provider}-fixture-model`,
            risk: "NORMAL",
            components: [
              {
                kind: "INPUT_TOKENS",
                unit: "PER_MILLION_TOKENS",
                unit_price: "1.25",
                currency: "USD",
                tier_min_inclusive: "0",
                tier_max_exclusive: "200000",
              },
              {
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
      const submission = adapter.parse({
        operation_id: operation,
        fetched_at: fetched,
        raw_evidence: raw,
      });
      expect(submission.candidates[0]?.provider).toBe(adapter.provider);
      expect(submission.candidates[0]?.components).toHaveLength(2);
    }
  });

  it("parses frozen CFETS and PBOC fixtures", () => {
    expect(OFFICIAL_FX_RATE_ADAPTERS.map(({ publisher }) => publisher)).toEqual(["CFETS", "PBOC"]);
    for (const adapter of OFFICIAL_FX_RATE_ADAPTERS) {
      const submission = adapter.parse({
        operation_id: operation,
        fetched_at: fetched,
        raw_evidence: JSON.stringify({
          schema_version: "official-fx-rates@1.0.0",
          publisher: adapter.publisher,
          rates: [
            {
              base_currency: "USD",
              quote_currency: "CNY",
              rate: "7.1234",
              official_date: "2026-08-14",
            },
          ],
        }),
      });
      expect(submission.candidates[0]?.rate).toBe("7.1234");
    }
  });

  it("fails closed for unknown dimensions and oversized evidence", () => {
    const adapter = OFFICIAL_MODEL_PRICE_ADAPTERS[0]!;
    expect(() =>
      adapter.parse({
        operation_id: operation,
        fetched_at: fetched,
        raw_evidence: "x".repeat(MAX_PRICING_EVIDENCE_BYTES + 1),
      }),
    ).toThrow("PRICING_SOURCE_EVIDENCE_TOO_LARGE");
    expect(() =>
      adapter.parse({
        operation_id: operation,
        fetched_at: fetched,
        raw_evidence: JSON.stringify({
          schema_version: "official-model-pricing@1.0.0",
          provider: adapter.provider,
          models: [
            {
              model_id: "unsupported",
              risk: "NORMAL",
              components: [
                {
                  kind: "IMAGE_GENERATION",
                  unit: "PER_CALL",
                  unit_price: "1",
                  currency: "USD",
                  tier_min_inclusive: null,
                  tier_max_exclusive: null,
                },
              ],
            },
          ],
        }),
      }),
    ).toThrow();
  });
});
