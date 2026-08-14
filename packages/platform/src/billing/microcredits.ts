export const MICROCREDITS_PER_CREDIT = 1_000_000n;
export const MICROCREDITS_PER_CNY = 100_000_000n;
export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

const decimalPattern = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function bounded(value: bigint): bigint {
  if (value < 0n) throw new Error("MICROCREDIT_AMOUNT_NEGATIVE");
  if (value > POSTGRES_BIGINT_MAX) throw new Error("MICROCREDIT_AMOUNT_OVERFLOW");
  return value;
}

function decimalToScaledInteger(value: string, scale: number): bigint {
  const match = decimalPattern.exec(value);
  if (!match) throw new Error("DECIMAL_AMOUNT_INVALID");
  const fraction = match[2] ?? "";
  if (fraction.length > scale) throw new Error("DECIMAL_AMOUNT_PRECISION_EXCEEDED");
  const digits = `${match[1]}${fraction.padEnd(scale, "0")}`.replace(/^0+(?=\d)/, "");
  return bounded(BigInt(digits));
}

function scaledIntegerToDecimal(value: bigint, scale: number): string {
  bounded(value);
  if (value === 0n) return "0";
  const digits = value.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function creditAmountToMicrocredits(value: string): bigint {
  return decimalToScaledInteger(value, 6);
}

export function cnyAmountToMicrocredits(value: string): bigint {
  return decimalToScaledInteger(value, 8);
}

export function microcreditsToCreditAmount(value: bigint): string {
  return scaledIntegerToDecimal(value, 6);
}

export function microcreditsToCnyAmount(value: bigint): string {
  return scaledIntegerToDecimal(value, 8);
}

export function ceilRationalMicrocredits(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("MICROCREDIT_RATIO_INVALID");
  return bounded((numerator + denominator - 1n) / denominator);
}

export function roundHalfUpMicrocredits(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("MICROCREDIT_RATIO_INVALID");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return bounded(quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

export function addMicrocredits(left: bigint, right: bigint): bigint {
  return bounded(left + right);
}

export function subtractMicrocredits(left: bigint, right: bigint): bigint {
  return bounded(left - right);
}
