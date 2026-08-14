import { describe, expect, it, vi } from "vitest";
import {
  createPricingSyncCycle,
  createPricingSyncScheduler,
} from "../../src/pricing/pricing-sync-cycle.js";
import { OFFICIAL_MODEL_PRICE_ADAPTERS } from "../../src/pricing/official-source-adapters.js";

const context = {
  deployment_id: "00000000-0000-4000-8000-00000000de01",
  principal_id: "00000000-0000-4000-8000-000000001001",
};

describe("pricing sync cycle", () => {
  it("records a failed operation without activating or mutating any price version", async () => {
    const repository = {
      submitPriceSync: vi.fn(),
      submitFxSync: vi.fn(),
      recordSyncFailure: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    };
    const source = OFFICIAL_MODEL_PRICE_ADAPTERS[0]!;
    const cycle = createPricingSyncCycle({
      repository: repository as never,
      context,
      sources: [source],
      fetcher: { async fetch() { return "not-json"; } },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      operation_id: () => "00000000-0000-4000-8000-00000000a411",
    });

    await expect(cycle.runOnce()).resolves.toEqual([
      {
        adapter: source.adapter_version,
        status: "FAILED",
        error_code: "PRICING_SOURCE_JSON_INVALID",
      },
    ]);
    expect(repository.submitPriceSync).not.toHaveBeenCalled();
    expect(repository.recordSyncFailure).toHaveBeenCalledOnce();
  });

  it("schedules immediately, prevents overlapping cycles and stops cleanly", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const runOnce = vi.fn(
      () =>
        new Promise<readonly []>((resolve) => {
          release = () => resolve([]);
        }),
    );
    const scheduler = createPricingSyncScheduler({ cycle: { runOnce }, interval_ms: 1_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runOnce).toHaveBeenCalledOnce();
    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    vi.useRealTimers();
  });
});
