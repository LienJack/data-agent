import { describe, expect, it } from "vitest";
import {
  addMicrocredits,
  ceilRationalMicrocredits,
  cnyAmountToMicrocredits,
  creditAmountToMicrocredits,
  microcreditsToCnyAmount,
  microcreditsToCreditAmount,
  POSTGRES_BIGINT_MAX,
  roundHalfUpMicrocredits,
  subtractMicrocredits,
} from "../../src/billing/microcredits.js";

describe("microcredit arithmetic", () => {
  it("keeps the fixed 100 credits to 1 CNY ratio exactly", () => {
    expect(creditAmountToMicrocredits("100")).toBe(100_000_000n);
    expect(cnyAmountToMicrocredits("1")).toBe(100_000_000n);
    expect(microcreditsToCreditAmount(100_000_000n)).toBe("100");
    expect(microcreditsToCnyAmount(100_000_000n)).toBe("1");
    expect(creditAmountToMicrocredits("0.000001")).toBe(1n);
    expect(cnyAmountToMicrocredits("0.00000001")).toBe(1n);
  });

  it("ceil-reserves and half-up settles at the microcredit boundary", () => {
    expect(ceilRationalMicrocredits(1n, 3n)).toBe(1n);
    expect(ceilRationalMicrocredits(6n, 3n)).toBe(2n);
    expect(roundHalfUpMicrocredits(1n, 3n)).toBe(0n);
    expect(roundHalfUpMicrocredits(1n, 2n)).toBe(1n);
    expect(roundHalfUpMicrocredits(3n, 2n)).toBe(2n);
  });

  it("fails closed on invalid precision, underflow and PostgreSQL bigint overflow", () => {
    expect(() => creditAmountToMicrocredits("0.0000001")).toThrow(
      "DECIMAL_AMOUNT_PRECISION_EXCEEDED",
    );
    expect(() => cnyAmountToMicrocredits("01")).toThrow("DECIMAL_AMOUNT_INVALID");
    expect(() => subtractMicrocredits(1n, 2n)).toThrow("MICROCREDIT_AMOUNT_NEGATIVE");
    expect(() => addMicrocredits(POSTGRES_BIGINT_MAX, 1n)).toThrow("MICROCREDIT_AMOUNT_OVERFLOW");
    expect(() => ceilRationalMicrocredits(1n, 0n)).toThrow("MICROCREDIT_RATIO_INVALID");
  });
});
