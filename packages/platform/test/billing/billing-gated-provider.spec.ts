import { describe, expect, it, vi } from "vitest";
import { createBillingGatedProvider } from "../../src/billing/billing-gated-provider.js";

describe("billing-gated provider", () => {
  it("never reaches the provider when the hold or pricing chain is rejected", async () => {
    const provider = vi.fn();
    const gated = createBillingGatedProvider({
      billing: {
        authorize: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "CREDIT_AVAILABLE_INSUFFICIENT",
            message: "insufficient",
            retryable: false,
          },
        }),
      },
      invokeProvider: provider,
    });
    await expect(gated.invoke({}, {}, { prompt: "hello" })).resolves.toMatchObject({
      ok: false,
      error: { code: "CREDIT_AVAILABLE_INSUFFICIENT" },
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it("passes the committed billing authorization to the provider delegate", async () => {
    const authorization = {
      operation_id: "00000000-0000-4000-8000-000000008001",
      provider_call_allowed: true,
      bill: { bill_id: "00000000-0000-4000-8000-000000008002" },
      hold: null,
      account: null,
    };
    const provider = vi.fn().mockResolvedValue({ text: "ok" });
    const gated = createBillingGatedProvider({
      billing: { authorize: vi.fn().mockResolvedValue({ ok: true, value: authorization }) },
      invokeProvider: provider,
    });
    const result = await gated.invoke({}, {}, { prompt: "hello" });
    expect(result).toMatchObject({ ok: true, value: { provider_result: { text: "ok" } } });
    expect(provider).toHaveBeenCalledWith({ prompt: "hello" }, authorization);
  });
});
