import { describe, expect, it } from "vitest";
import {
  creditAdjustmentInputSchema,
  creditHoldReservationInputSchema,
  creditLedgerEntrySchema,
} from "../src/workspaces/billing.js";

const ids = {
  operation: "00000000-0000-4000-8000-000000004001",
  principal: "00000000-0000-4000-8000-000000004002",
  hold: "00000000-0000-4000-8000-000000004003",
  invocation: "00000000-0000-4000-8000-000000004004",
  workspace: "00000000-0000-4000-8000-000000004005",
};

describe("credit ledger contracts", () => {
  it("accepts canonical string amounts and rejects zero or number adjustment amounts", () => {
    const valid = {
      schema_version: "credit-adjustment@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "credit-adjustment-1",
      target_principal_id: ids.principal,
      signed_microcredits: "1000000",
      reason: "initial development credits",
      expected_account_version: 0,
    };
    expect(creditAdjustmentInputSchema.parse(valid).signed_microcredits).toBe("1000000");
    expect(
      creditAdjustmentInputSchema.safeParse({ ...valid, signed_microcredits: "0" }).success,
    ).toBe(false);
    expect(
      creditAdjustmentInputSchema.safeParse({ ...valid, signed_microcredits: 1_000_000 }).success,
    ).toBe(false);
    expect(creditAdjustmentInputSchema.safeParse({ ...valid, role: "SUPER_ADMIN" }).success).toBe(
      false,
    );
  });

  it("requires a positive hold and rejects client supplied principal identity", () => {
    const valid = {
      schema_version: "credit-hold-reserve@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "credit-hold-reserve-1",
      hold_id: ids.hold,
      invocation_id: ids.invocation,
      workspace_id: ids.workspace,
      reserved_microcredits: "1",
      expected_account_version: 1,
    };
    expect(creditHoldReservationInputSchema.parse(valid).reserved_microcredits).toBe("1");
    expect(
      creditHoldReservationInputSchema.safeParse({ ...valid, reserved_microcredits: "0" }).success,
    ).toBe(false);
    expect(
      creditHoldReservationInputSchema.safeParse({ ...valid, principal_id: ids.principal }).success,
    ).toBe(false);
  });

  it("keeps immutable ledger receipts self-contained for balance reconstruction", () => {
    expect(
      creditLedgerEntrySchema.parse({
        schema_version: "credit-ledger-entry@1.0.0",
        entry_id: ids.operation,
        app_id: "00000000-0000-4000-8000-00000000da01",
        environment: "test",
        principal_id: ids.principal,
        workspace_id: null,
        kind: "GRANT",
        signed_microcredits: "100000000",
        actor_principal_id: ids.principal,
        reason: "grant",
        idempotency_key: "credit-ledger-entry-1",
        balance_before_microcredits: "0",
        balance_after_microcredits: "100000000",
        account_version: 1,
        created_at: "2026-08-14T00:00:00.000Z",
      }).balance_after_microcredits,
    ).toBe("100000000");
  });
});
