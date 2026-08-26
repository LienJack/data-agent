import type { SqlClient, SqlPool, SqlQueryResult } from "@data-agent/platform/persistence";
import { describe, expect, it, vi } from "vitest";
import {
  acquireFalcon24SubmitGuard,
  claimFalcon24RunWithUnknownOutcomeRecovery,
  holdCampaignAfterFailure,
  projectFalcon24AcceptanceStatus,
  reconcileClaimedFalcon24Run,
  recoverAcceptedFalcon24RunAfterSubmitFailure,
  requireSucceededFalcon24Run,
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

  it("holds a crash-released PostgreSQL session guard across claim and Run acceptance", async () => {
    const release = vi.fn();
    const queries: string[] = [];
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>(text: string) {
        queries.push(text);
        const value = text.includes("pg_try_advisory_lock")
          ? { acquired: true }
          : text.includes("pg_backend_pid")
            ? { backend_pid: 42 }
            : { unlocked: true };
        return { rows: [value], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      },
      release,
    };
    const pool: SqlPool = { connect: async () => client };

    const guard = await acquireFalcon24SubmitGuard(pool, "campaign\0run");
    expect(guard).not.toBeNull();
    await guard?.assert_active();
    await guard?.release();
    expect(queries.map((query) => query.match(/pg_catalog\.(pg_[a-z_]+)/u)?.[1])).toEqual([
      "pg_try_advisory_lock",
      "pg_backend_pid",
      "pg_advisory_unlock",
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reports an active submit guard without claiming or holding the same run", async () => {
    const release = vi.fn();
    const client: SqlClient = {
      async query<Row extends object = Record<string, unknown>>() {
        return {
          rows: [{ acquired: false }],
          rowCount: 1,
        } as unknown as SqlQueryResult<Row>;
      },
      release,
    };
    const pool: SqlPool = { connect: async () => client };

    await expect(acquireFalcon24SubmitGuard(pool, "campaign\0run")).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
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

  it("reconciles an unknown claim COMMIT outcome by its exact persisted fence", async () => {
    const claimed = {
      status: "CLAIMED",
      claim_fence_hash: `sha256:${"a".repeat(64)}`,
      claim_fence_consumed_at: null,
    };
    const hold = vi.fn();

    await expect(
      claimFalcon24RunWithUnknownOutcomeRecovery({
        expected_fence_hash: claimed.claim_fence_hash,
        claim: vi.fn().mockRejectedValue(new Error("PERSISTENCE_TRANSACTION_FAILED")),
        load: vi.fn().mockResolvedValue(claimed),
        hold,
      }),
    ).resolves.toBe(claimed);
    expect(hold).not.toHaveBeenCalled();
  });

  it("never resubmits an already accepted run after a post-claim process crash", async () => {
    const binding = { run_id: "accepted-run" };
    const loadBinding = vi.fn().mockResolvedValue(binding);
    const hold = vi.fn();

    await expect(
      reconcileClaimedFalcon24Run({
        run_status: "CLAIMED",
        load_binding: loadBinding,
        hold,
      }),
    ).resolves.toEqual({ kind: "EXISTING_RUN_ACCEPTED", binding });
    expect(loadBinding).toHaveBeenCalledTimes(1);
    expect(hold).not.toHaveBeenCalled();
  });

  it("holds an orphaned claim instead of invoking the provider again", async () => {
    const loadBinding = vi.fn().mockResolvedValue(null);
    const hold = vi.fn().mockResolvedValue({ ok: true, value: { status: "HOLD" } });

    await expect(
      reconcileClaimedFalcon24Run({
        run_status: "CLAIMED",
        load_binding: loadBinding,
        hold,
      }),
    ).rejects.toThrow("FALCON24_CLAIM_ORPHANED");
    expect(loadBinding).toHaveBeenCalledTimes(1);
    expect(hold).toHaveBeenCalledTimes(1);
    expect(hold).toHaveBeenCalledWith("FALCON24_CLAIM_ORPHANED");
  });

  it("does not HOLD when a concurrent accept consumes the database fence first", async () => {
    const binding = { run_id: "accepted-run" };
    const loadBinding = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(binding);
    const hold = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "FALCON24_RUN_ACCEPTED_RECOVERY_REQUIRED",
        message: "Run acceptance won the row lock.",
        retryable: false,
      },
    });

    await expect(
      reconcileClaimedFalcon24Run({
        run_status: "CLAIMED",
        load_binding: loadBinding,
        hold,
      }),
    ).resolves.toEqual({ kind: "EXISTING_RUN_ACCEPTED", binding });
    expect(loadBinding).toHaveBeenCalledTimes(2);
  });

  it("reloads the binding when HOLD observes an atomically consumed submit fence", async () => {
    const binding = { run_id: "accepted-run" };
    const loadBinding = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(binding);
    const hold = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "FALCON24_RUN_ACCEPTED_RECOVERY_REQUIRED",
        message: "Run was accepted while HOLD waited on the fence.",
        retryable: false,
      },
    });

    await expect(
      recoverAcceptedFalcon24RunAfterSubmitFailure({
        original_error: new Error("PERSISTENCE_TRANSACTION_FAILED"),
        load_binding: loadBinding,
        hold,
      }),
    ).resolves.toEqual(binding);
    expect(loadBinding).toHaveBeenCalledTimes(2);
  });
});
