import { describe, expect, it } from "vitest";
import { directRunBoundProviderDispatcherInternals } from "../../src/providers/direct-run-bound-provider-dispatcher.js";

describe("direct run-bound provider retry policy", () => {
  it("retries a transient structured-output protocol failure once", () => {
    expect(
      directRunBoundProviderDispatcherInternals.retryableReason(
        "MODEL_STREAM_PROTOCOL_VIOLATION",
      ),
    ).toBe(true);
    expect(
      directRunBoundProviderDispatcherInternals.retryableReason("MODEL_PROVIDER_TIMEOUT"),
    ).toBe(true);
    expect(
      directRunBoundProviderDispatcherInternals.retryableReason("MODEL_PROVIDER_AUTH_FAILED"),
    ).toBe(false);
  });
});
