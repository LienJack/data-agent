import type {
  AppScope,
  PortResult,
  SemanticAuthoringLease,
  SemanticAuthoringQueuePort,
} from "@data-agent/contracts";
import type { WorkerSemanticAuthoringRunner } from "./authoring-runner.js";

export type SemanticAuthoringWorkerCycleOutcome =
  | { readonly kind: "IDLE" }
  | {
      readonly kind: "PROCESSED";
      readonly authoring_run_id: string;
      readonly terminal_status: "WAITING_CLARIFICATION" | "READY_FOR_REVIEW" | "FAILED";
      readonly working_revision: number;
      readonly event_sequence: number;
    };

export interface SemanticAuthoringWorkerCycleRunner {
  runOnce(input: {
    readonly scope: AppScope;
    readonly worker_id: string;
    readonly lease_duration_ms: number;
  }): Promise<PortResult<SemanticAuthoringWorkerCycleOutcome>>;
}

function failure<T>(code: string, message: string, retryable: boolean): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

export function createSemanticAuthoringWorkerCycleRunner(input: {
  readonly queue: SemanticAuthoringQueuePort;
  readonly create_runner: (
    beforeStep: WorkerSemanticAuthoringRunnerFactoryHeartbeat,
  ) => WorkerSemanticAuthoringRunner;
}): SemanticAuthoringWorkerCycleRunner {
  const runner: SemanticAuthoringWorkerCycleRunner = {
    async runOnce(cycleInput) {
      const claimed = await input.queue.claimNext(cycleInput);
      if (!claimed.ok) return claimed;
      if (claimed.value === null) return { ok: true, value: { kind: "IDLE" } };

      let lease: SemanticAuthoringLease = claimed.value.lease;
      const heartbeat: WorkerSemanticAuthoringRunnerFactoryHeartbeat = async () => {
        const renewed = await input.queue.heartbeat({
          lease,
          lease_duration_ms: cycleInput.lease_duration_ms,
        });
        if (!renewed.ok) return renewed;
        lease = renewed.value;
        return { ok: true, value: undefined };
      };

      let execution: Awaited<ReturnType<WorkerSemanticAuthoringRunner["recover"]>>;
      try {
        execution = await input.create_runner(heartbeat).recover(claimed.value.state);
      } catch {
        execution = failure(
          "SEMANTIC_AUTHORING_WORKER_CRASH",
          "语义创作 Worker 执行失败；checkpoint 已保留，可安全重试。",
          true,
        );
      }

      const released = await input.queue.release({ lease });
      if (!released.ok) return released;
      if (!execution.ok) return execution;
      const status = execution.value.run.status;
      if (
        status !== "WAITING_CLARIFICATION" &&
        status !== "READY_FOR_REVIEW" &&
        status !== "FAILED"
      ) {
        return failure(
          "SEMANTIC_AUTHORING_WORKER_NON_TERMINAL",
          "语义创作 Worker 释放租约时任务仍处于非终态。",
          true,
        );
      }
      return {
        ok: true,
        value: {
          kind: "PROCESSED",
          authoring_run_id: execution.value.run.authoring_run_id,
          terminal_status: status,
          working_revision: execution.value.run.working_revision,
          event_sequence: execution.value.event_sequence,
        },
      };
    },
  };
  return Object.freeze(runner);
}

export type WorkerSemanticAuthoringRunnerFactoryHeartbeat = () => Promise<PortResult<void>>;
