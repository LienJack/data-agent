import {
  type AuthoritativeModelProviderInvocation,
  isAuthoritativeModelProviderInvocation,
  type ModelProviderEvent,
  type ModelProviderPort,
  parseModelProviderEventForRequest,
  sha256ContentHash,
} from "@data-agent/contracts";
import { MastraExecutionError, normalizeMastraExecutionError } from "./errors.js";
import {
  type ModelExecutionBridge,
  type ModelExecutionChunk,
  modelExecutionChunkSchema,
} from "./execution-bridge.js";

export interface ModelProviderAdapterClock {
  now(): Date;
}

const systemClock: ModelProviderAdapterClock = {
  now: () => new Date(),
};

class InvocationTimeoutError extends Error {
  override readonly name = "InvocationTimeoutError";
}

function assertUsageWithinBudget(
  request: AuthoritativeModelProviderInvocation,
  completion: Extract<ModelExecutionChunk, { chunk_type: "COMPLETED" }>,
  observedToolCalls: number,
): void {
  if (completion.usage.input_tokens > request.budget.max_input_tokens) {
    throw new MastraExecutionError(
      "MODEL_INPUT_TOKEN_BUDGET_EXCEEDED",
      false,
      "Model Provider 返回的 Input Token Usage 超过授权预算。",
    );
  }
  if (completion.usage.output_tokens > request.budget.max_output_tokens) {
    throw new MastraExecutionError(
      "MODEL_OUTPUT_TOKEN_BUDGET_EXCEEDED",
      false,
      "Model Provider 返回的 Output Token Usage 超过授权预算。",
    );
  }
  if (
    completion.usage.tool_calls !== observedToolCalls ||
    completion.usage.tool_calls > request.budget.max_tool_calls
  ) {
    throw new MastraExecutionError(
      completion.usage.tool_calls === observedToolCalls
        ? "MODEL_TOOL_CALL_BUDGET_EXCEEDED"
        : "MODEL_USAGE_MISMATCH",
      false,
      "Model Provider 返回的 Tool Usage 与已观察事件或授权预算不一致。",
    );
  }
}

function nextSequenceEvent(
  request: AuthoritativeModelProviderInvocation,
  clock: ModelProviderAdapterClock,
  sequence: number,
  payload:
    | { readonly event_type: "STARTED" }
    | { readonly event_type: "TEXT_DELTA"; readonly delta: string }
    | {
        readonly event_type: "TOOL_CALL_CANDIDATE";
        readonly tool_call_id: string;
        readonly tool_name: string;
        readonly arguments: unknown;
      }
    | {
        readonly event_type: "COMPLETED";
        readonly output_text: string;
        readonly response_hash: `sha256:${string}`;
        readonly usage: {
          readonly input_tokens: number;
          readonly output_tokens: number;
          readonly tool_calls: number;
        };
      }
    | {
        readonly event_type: "FAILED";
        readonly reason_code: string;
        readonly retryable: boolean;
      },
): ModelProviderEvent {
  return parseModelProviderEventForRequest(request, {
    schema_version: request.schema_version,
    request_id: request.request_id,
    attempt_id: request.attempt_id,
    scope: request.scope,
    run_id: request.run_id,
    provider: request.provider,
    profile_id: request.profile_id,
    profile_version: request.profile_version,
    model_id: request.model_id,
    sequence,
    observed_at: clock.now().toISOString(),
    ...payload,
  });
}

function failedEvent(
  request: AuthoritativeModelProviderInvocation,
  clock: ModelProviderAdapterClock,
  sequence: number,
  error: unknown,
): ModelProviderEvent {
  const normalized = normalizeMastraExecutionError(error);
  return nextSequenceEvent(request, clock, sequence, {
    event_type: "FAILED",
    reason_code: normalized.reason_code,
    retryable: normalized.retryable,
  });
}

/**
 * Project-owned ModelProviderPort implementation.
 *
 * The injected bridge may use Mastra, but all public event correlation,
 * budget enforcement, terminal semantics, and error redaction are owned here.
 */
export class MastraModelProviderAdapter implements ModelProviderPort {
  readonly #bridge: ModelExecutionBridge;
  readonly #clock: ModelProviderAdapterClock;

  constructor(options: {
    readonly bridge: ModelExecutionBridge;
    readonly clock?: ModelProviderAdapterClock;
  }) {
    this.#bridge = options.bridge;
    this.#clock = options.clock ?? systemClock;
  }

  async *stream(input: AuthoritativeModelProviderInvocation): AsyncIterable<ModelProviderEvent> {
    if (!isAuthoritativeModelProviderInvocation(input)) {
      throw new MastraExecutionError(
        "MODEL_PROVIDER_REQUEST_NOT_AUTHORIZED",
        false,
        "Model Provider Adapter 只接受已授权调用。",
      );
    }

    let sequence = 0;
    yield nextSequenceEvent(input, this.#clock, sequence, { event_type: "STARTED" });
    sequence += 1;

    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let iterator: AsyncIterator<ModelExecutionChunk> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new InvocationTimeoutError());
      }, input.budget.timeout_ms);
    });

    try {
      iterator = this.#bridge
        .stream({
          request: input,
          signal: controller.signal,
        })
        [Symbol.asyncIterator]();

      let completion: Extract<ModelExecutionChunk, { chunk_type: "COMPLETED" }> | undefined;
      let observedToolCalls = 0;
      const observedToolCallIds = new Set<string>();
      const responseToolCalls: Array<{
        readonly tool_call_id: string;
        readonly tool_name: string;
        readonly arguments: unknown;
      }> = [];

      while (true) {
        const next = await Promise.race([iterator.next(), timeout]);
        if (next.done) {
          break;
        }

        const chunkResult = modelExecutionChunkSchema.safeParse(next.value);
        if (!chunkResult.success) {
          throw new MastraExecutionError(
            "MODEL_STREAM_PROTOCOL_VIOLATION",
            false,
            "Model Execution Bridge 返回了无效事件。",
          );
        }
        const chunk = chunkResult.data;
        if (completion) {
          throw new MastraExecutionError(
            "MODEL_STREAM_PROTOCOL_VIOLATION",
            false,
            "Model Stream 在完成标记后仍产生事件。",
          );
        }

        switch (chunk.chunk_type) {
          case "TEXT_DELTA":
            yield nextSequenceEvent(input, this.#clock, sequence, {
              event_type: "TEXT_DELTA",
              delta: chunk.delta,
            });
            sequence += 1;
            break;
          case "TOOL_CALL_CANDIDATE":
            if (!input.tool_allowlist.includes(chunk.tool_name)) {
              throw new MastraExecutionError(
                "MODEL_TOOL_NOT_ALLOWED",
                false,
                "Model 产生了未在 Request Allowlist 中声明的 Tool Call。",
              );
            }
            observedToolCalls += 1;
            if (observedToolCallIds.has(chunk.tool_call_id)) {
              throw new MastraExecutionError(
                "MODEL_STREAM_PROTOCOL_VIOLATION",
                false,
                "Model Stream 不允许重复 Tool Call ID。",
              );
            }
            observedToolCallIds.add(chunk.tool_call_id);
            if (observedToolCalls > input.budget.max_tool_calls) {
              throw new MastraExecutionError(
                "MODEL_TOOL_CALL_BUDGET_EXCEEDED",
                false,
                "Model Tool Call 数量超过授权预算。",
              );
            }
            responseToolCalls.push({
              tool_call_id: chunk.tool_call_id,
              tool_name: chunk.tool_name,
              arguments: chunk.arguments,
            });
            yield nextSequenceEvent(input, this.#clock, sequence, {
              event_type: "TOOL_CALL_CANDIDATE",
              tool_call_id: chunk.tool_call_id,
              tool_name: chunk.tool_name,
              arguments: chunk.arguments,
            });
            sequence += 1;
            break;
          case "COMPLETED":
            completion = chunk;
            break;
        }
      }

      if (!completion) {
        throw new MastraExecutionError(
          "MODEL_STREAM_PROTOCOL_VIOLATION",
          false,
          "Model Stream 未产生完成标记。",
        );
      }

      assertUsageWithinBudget(input, completion, observedToolCalls);
      const responseHash = await sha256ContentHash({
        output_text: completion.output_text,
        tool_calls: responseToolCalls,
      });
      yield nextSequenceEvent(input, this.#clock, sequence, {
        event_type: "COMPLETED",
        output_text: completion.output_text,
        response_hash: responseHash,
        usage: completion.usage,
      });
    } catch (error) {
      const normalizedError =
        error instanceof InvocationTimeoutError
          ? new MastraExecutionError(
              "MODEL_PROVIDER_TIMEOUT",
              true,
              "Model Provider 调用超过授权超时预算。",
            )
          : error;
      yield failedEvent(input, this.#clock, sequence, normalizedError);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      controller.abort();
      if (iterator?.return) {
        void iterator.return().catch(() => undefined);
      }
    }
  }
}
