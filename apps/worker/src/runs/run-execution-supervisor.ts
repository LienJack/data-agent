import type { ContractError } from "@data-agent/contracts";
import type { RunExecutionContext } from "./run-worker-runner.js";

export type SupervisedOperationOutcome<T> =
  | Readonly<{ kind: "RESULT"; value: T }>
  | Readonly<{ kind: "ERROR" }>
  | Readonly<{ kind: "DEADLINE" }>
  | Readonly<{ kind: "HEARTBEAT_FAILED"; error: ContractError }>;

interface RunExecutionSupervisorDependencies {
  readonly context: RunExecutionContext;
  readonly controller: AbortController;
  readonly execution_timeout_ms: number;
  readonly heartbeat_interval_ms: number;
}

export interface RunExecutionSupervisor {
  waitFor<T>(operation: () => Promise<T>): Promise<SupervisedOperationOutcome<T>>;
  markExecutorSettled(): void;
  stop(): void;
}

export function createRunExecutionSupervisor({
  context,
  controller,
  execution_timeout_ms: executionTimeoutMs,
  heartbeat_interval_ms: heartbeatIntervalMs,
}: RunExecutionSupervisorDependencies): RunExecutionSupervisor {
  let heartbeatActive = false;
  let supervisionStopped = false;
  let stopSupervision:
    | ((
        stop:
          | Readonly<{ kind: "DEADLINE" }>
          | Readonly<{ kind: "HEARTBEAT_FAILED"; error: ContractError }>,
      ) => void)
    | undefined;
  const supervisionStop = new Promise<
    Readonly<{ kind: "DEADLINE" }> | Readonly<{ kind: "HEARTBEAT_FAILED"; error: ContractError }>
  >((resolve) => {
    stopSupervision = resolve;
  });
  const stopWith = (
    reason:
      | Readonly<{ kind: "DEADLINE" }>
      | Readonly<{ kind: "HEARTBEAT_FAILED"; error: ContractError }>,
  ) => {
    if (supervisionStopped) return;
    supervisionStopped = true;
    stopSupervision?.(reason);
    controller.abort(new Error(reason.kind));
  };
  const deadlineTimer = setTimeout(() => stopWith({ kind: "DEADLINE" }), executionTimeoutMs);
  const heartbeatTimer = setInterval(() => {
    if (heartbeatActive || supervisionStopped) return;
    heartbeatActive = true;
    void context
      .heartbeat()
      .then((result) => {
        if (!result.ok) {
          stopWith({ kind: "HEARTBEAT_FAILED", error: result.error });
        }
      })
      .finally(() => {
        heartbeatActive = false;
      });
  }, heartbeatIntervalMs);
  return {
    waitFor<T>(operation: () => Promise<T>) {
      const execution = Promise.resolve()
        .then(operation)
        .then(
          (value) => ({ kind: "RESULT" as const, value }),
          () => ({ kind: "ERROR" as const }),
        );
      return Promise.race([execution, supervisionStop]);
    },
    markExecutorSettled() {
      clearTimeout(deadlineTimer);
    },
    stop() {
      supervisionStopped = true;
      clearTimeout(deadlineTimer);
      clearInterval(heartbeatTimer);
      if (!controller.signal.aborted) {
        controller.abort(new Error("RUN_EXECUTION_SETTLED"));
      }
    },
  };
}
