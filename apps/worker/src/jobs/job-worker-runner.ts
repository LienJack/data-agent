import { randomUUID } from "node:crypto";
import {
  type AppScope,
  type ArtifactReference,
  buildJobWorkerHeartbeat,
  type JobHandlerBinding,
  type JobKind,
  type JobQueuePort,
  type JobWorkLease,
  type PortResult,
} from "@data-agent/contracts";

export interface JobHandler {
  readonly binding: JobHandlerBinding;
  execute(
    lease: JobWorkLease,
    signal: AbortSignal,
  ): Promise<PortResult<readonly ArtifactReference[]>>;
}

export type JobWorkerCycleOutcome =
  | { readonly kind: "IDLE" }
  | { readonly kind: "COMPLETED"; readonly job_id: string }
  | { readonly kind: "RETRY_SCHEDULED"; readonly job_id: string }
  | { readonly kind: "CANCELLED"; readonly job_id: string }
  | { readonly kind: "FAILED"; readonly job_id: string; readonly error_code: string };

export function createJobWorkerRunner(
  options: Readonly<{
    queue: JobQueuePort;
    handlers: readonly JobHandler[];
    lease_duration_ms: number;
    now?: () => Date;
    create_id?: () => string;
  }>,
) {
  const handlers = new Map<JobKind, JobHandler>(
    options.handlers.map((handler) => [handler.binding.kind, handler]),
  );
  const bindings = [...options.handlers.map(({ binding }) => binding)].sort((left, right) =>
    left.kind.localeCompare(right.kind),
  );
  const now = options.now ?? (() => new Date());
  const createId = options.create_id ?? randomUUID;

  return {
    async runOnce(
      input: Readonly<{
        scope: AppScope;
        worker_id: string;
        signal: AbortSignal;
      }>,
    ): Promise<PortResult<JobWorkerCycleOutcome>> {
      const observedAt = now();
      const heartbeat = await buildJobWorkerHeartbeat({
        schema_version: "job-worker-heartbeat@1.0.0",
        heartbeat_id: createId(),
        scope: input.scope,
        worker_id: input.worker_id,
        handlers: bindings,
        capacity: 1,
        observed_at: observedAt.toISOString(),
        expires_at: new Date(observedAt.getTime() + options.lease_duration_ms).toISOString(),
      });
      const published = await options.queue.publishHeartbeat(heartbeat);
      if (!published.ok) return published;
      const claimed = await options.queue.claim({
        scope: input.scope,
        worker_id: input.worker_id,
        handlers: bindings,
      });
      if (!claimed.ok) return claimed;
      if (!claimed.value) return { ok: true, value: { kind: "IDLE" } };
      const lease = claimed.value;
      const handler = handlers.get(lease.kind);
      if (!handler || handler.binding.handler_revision !== lease.handler_revision) {
        return options.queue
          .fail({
            lease,
            error_code: "JOB_HANDLER_REVISION_MISMATCH",
            retryable: false,
            retry_delay_ms: null,
          })
          .then((result) =>
            result.ok
              ? {
                  ok: true,
                  value: {
                    kind: "FAILED",
                    job_id: lease.job_id,
                    error_code: "JOB_HANDLER_REVISION_MISMATCH",
                  },
                }
              : result,
          );
      }
      const started = await options.queue.start({ lease });
      if (!started.ok) return started;
      const active = await options.queue.heartbeat({ lease });
      if (!active.ok) return active;
      if (active.value.cancel_requested || input.signal.aborted) {
        const cancelled = await options.queue.acknowledgeCancel({
          lease,
          error_code: "JOB_CANCELLED_BY_REQUEST",
        });
        return cancelled.ok
          ? { ok: true, value: { kind: "CANCELLED", job_id: lease.job_id } }
          : cancelled;
      }
      let executed: PortResult<readonly ArtifactReference[]>;
      try {
        executed = await handler.execute(lease, input.signal);
      } catch {
        executed = {
          ok: false,
          error: {
            code: "JOB_HANDLER_CRASH",
            message: "Job Handler 发生未捕获错误。",
            retryable: true,
          },
        };
      }
      if (!executed.ok) {
        const failed = await options.queue.fail({
          lease,
          error_code: executed.error.code,
          retryable: executed.error.retryable,
          retry_delay_ms: executed.error.retryable ? 5_000 : null,
        });
        if (!failed.ok) return failed;
        return {
          ok: true,
          value: failed.value
            ? { kind: "FAILED", job_id: lease.job_id, error_code: executed.error.code }
            : { kind: "RETRY_SCHEDULED", job_id: lease.job_id },
        };
      }
      const completed = await options.queue.succeed({ lease, output_refs: executed.value });
      return completed.ok
        ? { ok: true, value: { kind: "COMPLETED", job_id: lease.job_id } }
        : completed;
    },
  };
}

export type JobWorkerRunner = ReturnType<typeof createJobWorkerRunner>;
