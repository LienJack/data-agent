import type { PublicRunEvent } from "@data-agent/contracts/runs";
import { streamRunEvents, waitWithBackoff } from "./api-client";
import type { RunConnectionState } from "./run-projection";

export interface QaRunStreamTransportInput {
  readonly cursor: number;
  readonly onEvent: (event: PublicRunEvent) => void;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly workspaceId: string;
}

export interface QaRunStreamDependencies {
  readonly open: (input: QaRunStreamTransportInput) => Promise<void>;
  readonly wait: (attempt: number, signal: AbortSignal) => Promise<void>;
}

export interface QaRunStreamSnapshot {
  readonly cursor: number;
  readonly reconnect_attempt: number;
  readonly terminal: boolean;
}

export interface QaRunStreamResult extends QaRunStreamSnapshot {
  readonly aborted: boolean;
  readonly error: unknown;
  readonly exhausted: boolean;
}

export interface QaRunStreamSession {
  readonly signal: AbortSignal;
  abort(): void;
  run(): Promise<QaRunStreamResult>;
}

export interface CreateQaRunStreamInput {
  readonly initial_cursor?: number;
  readonly max_reconnect_attempts?: number;
  readonly onConnection: (state: RunConnectionState) => void;
  readonly onEvent: (event: PublicRunEvent, snapshot: QaRunStreamSnapshot) => void;
  readonly run_id: string;
  readonly workspace_id: string;
}

const productionDependencies: QaRunStreamDependencies = {
  open: streamRunEvents,
  wait: waitWithBackoff,
};

export function createQaRunStream(
  input: CreateQaRunStreamInput,
  dependencies: QaRunStreamDependencies = productionDependencies,
): QaRunStreamSession {
  const controller = new AbortController();
  const maxReconnectAttempts = input.max_reconnect_attempts ?? 8;
  let started = false;

  return {
    abort: () => controller.abort(),
    async run() {
      if (started) throw new TypeError("QA_RUN_STREAM_SESSION_ALREADY_STARTED");
      started = true;
      let cursor = input.initial_cursor ?? 0;
      let reconnectAttempt = 0;
      let terminal = false;
      let lastError: unknown;

      while (!terminal && !controller.signal.aborted) {
        input.onConnection(reconnectAttempt === 0 ? "connecting" : "reconnecting");
        try {
          await dependencies.open({
            cursor,
            onEvent: (event) => {
              if (event.sequence <= cursor) return;
              cursor = event.sequence;
              terminal = event.type === "terminal";
              input.onEvent(event, { cursor, reconnect_attempt: reconnectAttempt, terminal });
              input.onConnection(terminal ? "closed" : "live");
            },
            runId: input.run_id,
            signal: controller.signal,
            workspaceId: input.workspace_id,
          });
          if (!terminal) reconnectAttempt += 1;
        } catch (error) {
          if (controller.signal.aborted) break;
          lastError = error;
          reconnectAttempt += 1;
        }

        if (!terminal && !controller.signal.aborted && reconnectAttempt <= maxReconnectAttempts) {
          await dependencies.wait(reconnectAttempt, controller.signal);
        }
        if (reconnectAttempt > maxReconnectAttempts) break;
      }

      return {
        aborted: controller.signal.aborted,
        cursor,
        error: lastError,
        exhausted: !terminal && !controller.signal.aborted,
        reconnect_attempt: reconnectAttempt,
        terminal,
      };
    },
    signal: controller.signal,
  };
}
