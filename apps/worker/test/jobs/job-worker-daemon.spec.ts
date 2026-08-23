import type { AppScope } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { runJobWorkerLoop } from "../../src/jobs/job-worker-daemon.js";
import type { JobWorkerRunner } from "../../src/jobs/job-worker-runner.js";
import { createInitialWorkerHealth } from "../../src/runs/run-worker-daemon.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const satisfies AppScope;

describe("Job Worker daemon", () => {
  it("reports Job Queue health independently and redacts a thrown handler error", async () => {
    const abort = new AbortController();
    const runOnce = vi
      .fn<JobWorkerRunner["runOnce"]>()
      .mockRejectedValueOnce(new Error("postgres://user:secret@db.example/data_agent"))
      .mockResolvedValueOnce({ ok: true, value: { kind: "IDLE" } });
    const health = createInitialWorkerHealth(false);
    health.run_queue_ready = true;
    const records: unknown[] = [];
    const sleep = vi.fn(async () => {
      if (runOnce.mock.calls.length === 2) abort.abort();
    });

    await runJobWorkerLoop({
      runner: { runOnce },
      scope,
      worker_id: "worker-local-test:jobs",
      poll_interval_ms: 1_000,
      signal: abort.signal,
      health,
      sleep,
      logger: (record) => records.push(record),
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(records)).not.toContain("secret");
    expect(records[0]).toEqual({
      level: "error",
      event_name: "job_worker_cycle_failed",
      reason_code: "JOB_WORKER_PROCESS_CRASH",
      retryable: true,
    });
    expect(health).toMatchObject({
      initialized: false,
      run_queue_ready: true,
      job_queue_ready: false,
      job_last_cycle_at: "2026-08-17T12:00:00.000Z",
      job_last_cycle_kind: "IDLE",
      job_last_error_code: null,
    });
  });
});
