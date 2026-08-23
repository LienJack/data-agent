import { setTimeout as delay } from "node:timers/promises";
import type { AppScope } from "@data-agent/contracts";
import type { WorkerHealthState } from "../runs/run-worker-daemon.js";
import type { JobWorkerRunner } from "./job-worker-runner.js";

export type JobWorkerCycleLogRecord = Readonly<{
  level: "info" | "warn" | "error";
  event_name: "job_worker_cycle" | "job_worker_cycle_failed";
  cycle_kind?: "IDLE" | "COMPLETED" | "RETRY_SCHEDULED" | "CANCELLED" | "FAILED";
  job_id?: string;
  reason_code?: string;
  retryable?: boolean;
}>;

export async function runJobWorkerLoop(
  options: Readonly<{
    runner: JobWorkerRunner;
    scope: AppScope;
    worker_id: string;
    poll_interval_ms: number;
    signal: AbortSignal;
    health: WorkerHealthState;
    logger?: (record: JobWorkerCycleLogRecord) => void;
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    now?: () => Date;
  }>,
): Promise<void> {
  const sleep =
    options.sleep ??
    (async (milliseconds: number, signal: AbortSignal) => {
      await delay(milliseconds, undefined, { signal }).catch((error: unknown) => {
        if (!signal.aborted) throw error;
      });
    });
  const now = options.now ?? (() => new Date());
  options.health.job_queue_ready = true;
  options.health.initialized = options.health.run_queue_ready;
  while (!options.signal.aborted) {
    try {
      const result = await options.runner.runOnce({
        scope: options.scope,
        worker_id: options.worker_id,
        signal: options.signal,
      });
      options.health.job_last_cycle_at = now().toISOString();
      if (result.ok) {
        options.health.job_last_cycle_kind = result.value.kind;
        options.health.job_last_error_code = null;
        options.logger?.({
          level: "info",
          event_name: "job_worker_cycle",
          cycle_kind: result.value.kind,
          ...(result.value.kind === "IDLE" ? {} : { job_id: result.value.job_id }),
        });
        if (result.value.kind !== "IDLE") continue;
      } else {
        options.health.job_last_cycle_kind = null;
        options.health.job_last_error_code = result.error.code;
        options.logger?.({
          level: result.error.retryable ? "warn" : "error",
          event_name: "job_worker_cycle_failed",
          reason_code: result.error.code,
          retryable: result.error.retryable,
        });
      }
    } catch {
      options.health.job_last_cycle_at = now().toISOString();
      options.health.job_last_cycle_kind = null;
      options.health.job_last_error_code = "JOB_WORKER_PROCESS_CRASH";
      options.logger?.({
        level: "error",
        event_name: "job_worker_cycle_failed",
        reason_code: "JOB_WORKER_PROCESS_CRASH",
        retryable: true,
      });
    }
    await sleep(options.poll_interval_ms, options.signal);
  }
  options.health.job_queue_ready = false;
  options.health.initialized = false;
}
