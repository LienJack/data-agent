import { describe, expect, it } from "vitest";
import { calculateModelCost } from "../../src/billing/model-cost.js";

const component = (overrides: Record<string, unknown> = {}) => ({
  component_id: "00000000-0000-4000-8000-000000005001",
  kind: "INPUT_TOKENS" as const,
  unit: "PER_MILLION_TOKENS" as const,
  unit_price: "2.5",
  currency: "USD",
  tier_min_inclusive: null,
  tier_max_exclusive: null,
  ...overrides,
});

const usage = {
  input_tokens: "1000",
  output_tokens: "0",
  cache_read_tokens: "0",
  cache_write_tokens: "0",
  tool_calls: "0",
};

describe("model billing cost", () => {
  it("computes an independently reproducible official, CNY and microcredit amount", () => {
    expect(
      calculateModelCost({ components: [component()], usage, fx_rate: "7.2", rounding: "HALF_UP" }),
    ).toEqual({
      official_currency: "USD",
      official_cost: "0.0025",
      cny_cost: "0.018",
      microcredits: 1_800_000n,
      rounding_delta_microcredits: 0n,
    });
  });

  it("ceil-reserves sub-microcredit costs while settlement rounds half-up", () => {
    const tiny = component({ unit_price: "0.000001" });
    expect(
      calculateModelCost({ components: [tiny], usage, fx_rate: "1", rounding: "CEIL" })
        .microcredits,
    ).toBe(1n);
    expect(
      calculateModelCost({ components: [tiny], usage, fx_rate: "1", rounding: "HALF_UP" })
        .microcredits,
    ).toBe(0n);
  });

  it("prices tiers and rejects non-zero unpriced dimensions", () => {
    const tiers = [
      component({ tier_min_inclusive: "0", tier_max_exclusive: "1000", unit_price: "1" }),
      component({
        component_id: "00000000-0000-4000-8000-000000005002",
        tier_min_inclusive: "1000",
        tier_max_exclusive: null,
        unit_price: "2",
      }),
    ];
    expect(
      calculateModelCost({
        components: tiers,
        usage: { ...usage, input_tokens: "2000" },
        fx_rate: "1",
        rounding: "HALF_UP",
      }).official_cost,
    ).toBe("0.003");
    expect(() =>
      calculateModelCost({
        components: [component()],
        usage: { ...usage, output_tokens: "1" },
        fx_rate: "1",
        rounding: "CEIL",
      }),
    ).toThrow("MODEL_BILLING_DIMENSION_UNPRICED:OUTPUT_TOKENS");
  });

  it("rejects mixed currencies and invalid decimal precision", () => {
    expect(() =>
      calculateModelCost({
        components: [
          component(),
          component({ component_id: "00000000-0000-4000-8000-000000005003", currency: "CNY" }),
        ],
        usage,
        fx_rate: "1",
        rounding: "CEIL",
      }),
    ).toThrow("MODEL_BILLING_MIXED_CURRENCY_UNSUPPORTED");
    expect(() =>
      calculateModelCost({
        components: [component({ unit_price: "0.0000000000000000001" })],
        usage,
        fx_rate: "1",
        rounding: "CEIL",
      }),
    ).toThrow("MODEL_BILLING_DECIMAL_PRECISION_EXCEEDED");
  });
});
