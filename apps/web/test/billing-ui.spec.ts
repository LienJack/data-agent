import type { OperationsHealthGate } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isBillingUiEnabled } from "../src/lib/billing-ui";
import { visibleOperationsHealthGates } from "../src/lib/billing-ui-policy";

const identityGate = {
  key: "IDENTITY_SIDE_EFFECTS",
  status: "PASS",
  count: 0,
  reason_code: "IDENTITY_SIDE_EFFECTS_CLEAR",
  last_observed_at: null,
} satisfies OperationsHealthGate;

const billingGate = {
  key: "BILLING_REVIEW",
  status: "WARNING",
  count: 2,
  reason_code: "BILLING_REVIEW_REQUIRED",
  last_observed_at: null,
} satisfies OperationsHealthGate;

describe("billing UI policy", () => {
  it("stays disabled unless the server explicitly opts in", () => {
    expect(isBillingUiEnabled({})).toBe(false);
    expect(isBillingUiEnabled({ BILLING_UI_ENABLED: "0" })).toBe(false);
    expect(isBillingUiEnabled({ BILLING_UI_ENABLED: "false" })).toBe(false);
    expect(isBillingUiEnabled({ BILLING_UI_ENABLED: "unexpected" })).toBe(false);
    expect(isBillingUiEnabled({ BILLING_UI_ENABLED: "1" })).toBe(true);
    expect(isBillingUiEnabled({ BILLING_UI_ENABLED: "true" })).toBe(true);
  });

  it("removes billing gates from the operations projection while paused", () => {
    const gates = [identityGate, billingGate];

    expect(visibleOperationsHealthGates(gates, false)).toEqual([identityGate]);
    expect(visibleOperationsHealthGates(gates, true)).toBe(gates);
  });
});
