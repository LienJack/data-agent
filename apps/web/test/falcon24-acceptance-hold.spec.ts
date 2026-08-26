import { describe, expect, it, vi } from "vitest";
import {
  holdCampaignAfterFailure,
  projectFalcon24AcceptanceStatus,
  requireSucceededFalcon24Run,
  resolveFalcon24SubmitFailure,
} from "@/cli/falcon24-agent-acceptance";

vi.mock("server-only", () => ({}));

describe("Falcon24 acceptance campaign HOLD", () => {
  it("never labels HOLD or failed actual runs as READY status", () => {
    expect(projectFalcon24AcceptanceStatus({ status: "CLAIMED" }, { status: "RUNNING" })).toEqual({
      terminal: "STATUS",
      hard_stopped: false,
    });
    expect(projectFalcon24AcceptanceStatus({ status: "HOLD" }, { status: "FAILED" })).toEqual({
      terminal: "STATUS",
      hard_stopped: true,
    });
  });

  it("requires the exact persisted Run to be SUCCEEDED before trace verification", () => {
    expect(() =>
      requireSucceededFalcon24Run({ run_id: "run-1", status: "SUCCEEDED" }, "run-1"),
    ).not.toThrow();
    expect(() =>
      requireSucceededFalcon24Run({ run_id: "run-1", status: "RUNNING" }, "run-1"),
    ).toThrow("FALCON24_ACTUAL_RUN_NOT_SUCCEEDED");
    expect(() =>
      requireSucceededFalcon24Run({ run_id: "run-2", status: "SUCCEEDED" }, "run-1"),
    ).toThrow("FALCON24_ACTUAL_RUN_NOT_SUCCEEDED");
  });

  it("preserves the original error when the campaign is already held for its first failure", async () => {
    const originalError = new Error("FALCON24_RESOLUTION_TRACE_ARTIFACT_CORRUPT");
    const hold = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH",
        message: "Campaign already records a different first failure.",
        retryable: false,
      },
    });

    await expect(holdCampaignAfterFailure({ hold, originalError })).rejects.toBe(originalError);
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it("preserves the original error after recording a new campaign hold", async () => {
    const originalError = new Error("FALCON24_ANALYSIS_RESULT_NOT_STAGED");
    const hold = vi.fn().mockResolvedValue({ ok: true, value: { status: "HOLD" } });

    await expect(holdCampaignAfterFailure({ hold, originalError })).rejects.toBe(originalError);
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it("keeps the original failure primary when a different hold error occurs", async () => {
    const originalError = new Error("FALCON24_RESOLUTION_TRACE_EMPTY");
    const hold = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "FALCON24_CAMPAIGN_HOLD_INVALID",
        message: "Campaign hold rejected.",
        retryable: false,
      },
    });

    await expect(holdCampaignAfterFailure({ hold, originalError })).rejects.toMatchObject({
      code: "FALCON24_RESOLUTION_TRACE_EMPTY",
      hold_failure_code: "FALCON24_CAMPAIGN_HOLD_INVALID",
    });
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it("keeps the original failure primary when hold persistence throws", async () => {
    const originalError = new Error("FALCON24_ANALYSIS_RESULT_NOT_STAGED");
    const persistenceError = new Error("PERSISTENCE_TRANSACTION_FAILED");
    const hold = vi.fn().mockRejectedValue(persistenceError);

    await expect(holdCampaignAfterFailure({ hold, originalError })).rejects.toMatchObject({
      code: "FALCON24_ANALYSIS_RESULT_NOT_STAGED",
      hold_failure_code: "PERSISTENCE_TRANSACTION_FAILED",
    });
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it("durably holds a preflight failure without first exposing a separate CLAIMED state", async () => {
    const originalError = new Error("FALCON24_CAMPAIGN_FROZEN_AUTHORITY_MISMATCH");
    const events: string[] = [];
    const hold = vi.fn(async () => {
      events.push("hold");
      return { ok: true as const, value: { status: "HOLD" } };
    });

    await expect(holdCampaignAfterFailure({ hold, originalError })).rejects.toBe(originalError);
    expect(events).toEqual(["hold"]);
  });

  it("returns an exact accepted binding without resubmitting after an unknown submit outcome", async () => {
    const binding = { run_id: "accepted-run" };
    const loadBinding = vi.fn().mockResolvedValue(binding);
    const resolve = vi.fn().mockResolvedValue({ disposition: "ACCEPTED" });

    await expect(
      resolveFalcon24SubmitFailure({
        original_error: new Error("PERSISTENCE_TRANSACTION_FAILED"),
        resolve,
        load_binding: loadBinding,
      }),
    ).resolves.toEqual(binding);
    expect(resolve).toHaveBeenCalledWith("PERSISTENCE_TRANSACTION_FAILED");
    expect(loadBinding).toHaveBeenCalledTimes(1);
  });

  it("preserves the original submit failure after PostgreSQL atomically holds the campaign", async () => {
    const originalError = new Error("FALCON24_CLAIM_ORPHANED");
    const resolve = vi.fn().mockResolvedValue({
      disposition: "HELD",
      failure_code: "FALCON24_CLAIM_ORPHANED",
    });
    const loadBinding = vi.fn();

    await expect(
      resolveFalcon24SubmitFailure({
        original_error: originalError,
        resolve,
        load_binding: loadBinding,
      }),
    ).rejects.toBe(originalError);
    expect(resolve).toHaveBeenCalledWith("FALCON24_CLAIM_ORPHANED");
    expect(loadBinding).not.toHaveBeenCalled();
  });

  it("surfaces PostgreSQL authority corruption instead of masking it as the observed failure", async () => {
    const originalError = new Error("PERSISTENCE_TRANSACTION_FAILED");

    await expect(
      resolveFalcon24SubmitFailure({
        original_error: originalError,
        resolve: vi.fn().mockResolvedValue({
          disposition: "HELD",
          failure_code: "FALCON24_SUBMIT_AUTHORITY_CORRUPT",
        }),
        load_binding: vi.fn(),
      }),
    ).rejects.toMatchObject({
      message: "FALCON24_SUBMIT_AUTHORITY_CORRUPT",
      cause: originalError,
    });
  });

  it("fails closed when PostgreSQL reports ACCEPTED without the exact binding", async () => {
    const resolve = vi.fn().mockResolvedValue({ disposition: "ACCEPTED" });

    await expect(
      resolveFalcon24SubmitFailure({
        original_error: new Error("PERSISTENCE_TRANSACTION_FAILED"),
        resolve,
        load_binding: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_TRANSACTION_FAILED",
      hold_failure_code: "FALCON24_ACCEPTED_BINDING_MISSING",
    });
  });

  it("preserves the submit failure when PostgreSQL outcome resolution itself is unavailable", async () => {
    const originalError = new Error("FALCON24_CLAIM_ORPHANED");

    await expect(
      resolveFalcon24SubmitFailure({
        original_error: originalError,
        resolve: vi.fn().mockRejectedValue(new Error("PERSISTENCE_TRANSACTION_FAILED")),
        load_binding: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "FALCON24_CLAIM_ORPHANED",
      hold_failure_code: "PERSISTENCE_TRANSACTION_FAILED",
    });
  });
});
