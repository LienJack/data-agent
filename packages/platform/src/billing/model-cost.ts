import type { ModelBillingBudget, ModelBillPriceComponentSnapshot } from "@data-agent/contracts";
import { POSTGRES_BIGINT_MAX } from "./microcredits.js";

const DECIMAL_SCALE = 18;
const DECIMAL_FACTOR = 10n ** BigInt(DECIMAL_SCALE);
const TOKENS_PER_MILLION = 1_000_000n;
const MICROCREDITS_PER_CNY = 100_000_000n;
const decimalPattern = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

const usageFieldByKind = {
  INPUT_TOKENS: "input_tokens",
  OUTPUT_TOKENS: "output_tokens",
  CACHE_READ_TOKENS: "cache_read_tokens",
  CACHE_WRITE_TOKENS: "cache_write_tokens",
  TOOL_CALLS: "tool_calls",
} as const satisfies Record<ModelBillPriceComponentSnapshot["kind"], keyof ModelBillingBudget>;

function parseDecimal(value: string): bigint {
  const match = decimalPattern.exec(value);
  if (!match) throw new Error("MODEL_BILLING_DECIMAL_INVALID");
  const fraction = match[2] ?? "";
  if (fraction.length > DECIMAL_SCALE) throw new Error("MODEL_BILLING_DECIMAL_PRECISION_EXCEEDED");
  return BigInt(`${match[1]}${fraction.padEnd(DECIMAL_SCALE, "0")}`);
}

function parseCount(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("MODEL_BILLING_USAGE_INVALID");
  return BigInt(value);
}

function rounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function ceil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function decimal(value: bigint): string {
  if (value === 0n) return "0";
  const digits = value.toString().padStart(DECIMAL_SCALE + 1, "0");
  const whole = digits.slice(0, -DECIMAL_SCALE);
  const fraction = digits.slice(-DECIMAL_SCALE).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function unitMultiplier(unit: ModelBillPriceComponentSnapshot["unit"]): bigint {
  switch (unit) {
    case "PER_MILLION_TOKENS":
      return 1n;
    case "PER_THOUSAND_TOKENS":
      return 1_000n;
    case "PER_CALL":
      return TOKENS_PER_MILLION;
  }
}

function tierQuantity(quantity: bigint, component: ModelBillPriceComponentSnapshot): bigint {
  const minimum =
    component.tier_min_inclusive === null ? 0n : parseCount(component.tier_min_inclusive);
  const maximum =
    component.tier_max_exclusive === null ? quantity : parseCount(component.tier_max_exclusive);
  if (maximum <= minimum) throw new Error("MODEL_BILLING_TIER_INVALID");
  return quantity <= minimum ? 0n : (quantity < maximum ? quantity : maximum) - minimum;
}

export interface ModelCostResult {
  readonly official_currency: string;
  readonly official_cost: string;
  readonly cny_cost: string;
  readonly microcredits: bigint;
  readonly rounding_delta_microcredits: bigint;
}

export function calculateModelCost(input: {
  readonly components: readonly ModelBillPriceComponentSnapshot[];
  readonly usage: ModelBillingBudget;
  readonly fx_rate: string;
  readonly rounding: "CEIL" | "HALF_UP";
}): ModelCostResult {
  if (input.components.length === 0) throw new Error("MODEL_BILLING_PRICE_COMPONENTS_MISSING");
  const currencies = new Set(input.components.map((component) => component.currency));
  if (currencies.size !== 1) throw new Error("MODEL_BILLING_MIXED_CURRENCY_UNSUPPORTED");
  const officialCurrency = input.components[0]?.currency;
  if (!officialCurrency) throw new Error("MODEL_BILLING_PRICE_COMPONENTS_MISSING");

  let officialNumerator = 0n;
  const coveredKinds = new Set<ModelBillPriceComponentSnapshot["kind"]>();
  for (const component of input.components) {
    const quantity = parseCount(input.usage[usageFieldByKind[component.kind]]);
    const billedQuantity = tierQuantity(quantity, component);
    if (billedQuantity > 0n || quantity === 0n) coveredKinds.add(component.kind);
    officialNumerator +=
      parseDecimal(component.unit_price) * billedQuantity * unitMultiplier(component.unit);
  }
  for (const [kind, usageField] of Object.entries(usageFieldByKind) as readonly [
    ModelBillPriceComponentSnapshot["kind"],
    keyof ModelBillingBudget,
  ][]) {
    if (parseCount(input.usage[usageField]) > 0n && !coveredKinds.has(kind)) {
      throw new Error(`MODEL_BILLING_DIMENSION_UNPRICED:${kind}`);
    }
  }

  const fxRate = parseDecimal(input.fx_rate);
  if (fxRate === 0n) throw new Error("MODEL_BILLING_FX_INVALID");
  const officialScaled = rounded(officialNumerator, TOKENS_PER_MILLION);
  const cnyScaled = rounded(officialNumerator * fxRate, TOKENS_PER_MILLION * DECIMAL_FACTOR);
  const microcreditNumerator = officialNumerator * fxRate * MICROCREDITS_PER_CNY;
  const microcreditDenominator = TOKENS_PER_MILLION * DECIMAL_FACTOR * DECIMAL_FACTOR;
  const microcredits =
    input.rounding === "CEIL"
      ? ceil(microcreditNumerator, microcreditDenominator)
      : rounded(microcreditNumerator, microcreditDenominator);
  if (microcredits > POSTGRES_BIGINT_MAX) throw new Error("MICROCREDIT_AMOUNT_OVERFLOW");

  const cnyRoundedMicrocredits = rounded(cnyScaled * MICROCREDITS_PER_CNY, DECIMAL_FACTOR);
  return Object.freeze({
    official_currency: officialCurrency,
    official_cost: decimal(officialScaled),
    cny_cost: decimal(cnyScaled),
    microcredits,
    rounding_delta_microcredits: microcredits - cnyRoundedMicrocredits,
  });
}
