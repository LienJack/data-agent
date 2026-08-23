import type {
  MetamorphicFixtureReceipt,
  MetamorphicOracleReceipt,
  ResultOracleReceipt,
} from "./text2sql-evidence.js";

declare const authoritativeMetamorphicFixtureReceiptBrand: unique symbol;
export type AuthoritativeMetamorphicFixtureReceipt = MetamorphicFixtureReceipt & {
  readonly [authoritativeMetamorphicFixtureReceiptBrand]: true;
};

declare const authoritativeMetamorphicOracleReceiptBrand: unique symbol;
export type AuthoritativeMetamorphicOracleReceipt = MetamorphicOracleReceipt & {
  readonly [authoritativeMetamorphicOracleReceiptBrand]: true;
};

declare const authoritativeResultOracleReceiptBrand: unique symbol;
export type AuthoritativeResultOracleReceipt = ResultOracleReceipt & {
  readonly [authoritativeResultOracleReceiptBrand]: true;
};

const authoritativeFixtureReceipts = new WeakSet<object>();
const authoritativeOracleReceipts = new WeakSet<object>();
const authoritativeResultReceipts = new WeakSet<object>();
const authoritativeResultReceiptMetamorphicReceipts = new WeakMap<
  object,
  AuthoritativeMetamorphicOracleReceipt
>();

export function markAuthoritativeMetamorphicFixtureReceipt(
  value: MetamorphicFixtureReceipt,
): AuthoritativeMetamorphicFixtureReceipt {
  authoritativeFixtureReceipts.add(value);
  return value as AuthoritativeMetamorphicFixtureReceipt;
}

export function markAuthoritativeMetamorphicOracleReceipt(
  value: MetamorphicOracleReceipt,
): AuthoritativeMetamorphicOracleReceipt {
  authoritativeOracleReceipts.add(value);
  return value as AuthoritativeMetamorphicOracleReceipt;
}

export function markAuthoritativeResultOracleReceipt(
  value: ResultOracleReceipt,
  metamorphic: AuthoritativeMetamorphicOracleReceipt,
): AuthoritativeResultOracleReceipt {
  authoritativeResultReceipts.add(value);
  authoritativeResultReceiptMetamorphicReceipts.set(value, metamorphic);
  return value as AuthoritativeResultOracleReceipt;
}

export function isAuthoritativeMetamorphicFixtureReceipt(
  value: unknown,
): value is AuthoritativeMetamorphicFixtureReceipt {
  return typeof value === "object" && value !== null && authoritativeFixtureReceipts.has(value);
}

export function isAuthoritativeMetamorphicOracleReceipt(
  value: unknown,
): value is AuthoritativeMetamorphicOracleReceipt {
  return typeof value === "object" && value !== null && authoritativeOracleReceipts.has(value);
}

export function isAuthoritativeResultOracleReceipt(
  value: unknown,
): value is AuthoritativeResultOracleReceipt {
  return typeof value === "object" && value !== null && authoritativeResultReceipts.has(value);
}

export function isAuthoritativeResultOracleReceiptForMetamorphic(
  value: unknown,
  metamorphic: AuthoritativeMetamorphicOracleReceipt,
): value is AuthoritativeResultOracleReceipt {
  return (
    isAuthoritativeResultOracleReceipt(value) &&
    authoritativeResultReceiptMetamorphicReceipts.get(value) === metamorphic
  );
}
