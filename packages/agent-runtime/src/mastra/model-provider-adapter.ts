import {
  type AuthoritativeModelProviderInvocation,
  isAuthoritativeModelProviderInvocation,
  isAuthoritativePersistedModelProviderInvocation,
  isAuthoritativeSemanticAuthoringModelProviderInvocation,
  type ModelProviderEvent,
  type ModelProviderPort,
  parseModelProviderEventForRequest,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  isFullyObservedEmptyResponse,
  MastraExecutionError,
  normalizeMastraExecutionError,
} from "./errors.js";
import {
  type ModelExecutionBridge,
  type ModelExecutionChunk,
  modelExecutionChunkSchema,
} from "./execution-bridge.js";
import { modelProtocolDiagnostic } from "./protocol-diagnostic.js";

export interface ModelProviderAdapterClock {
  now(): Date;
}

export interface ProviderDispatchMarker {
  mark_dispatched(input: AuthoritativeModelProviderInvocation): Promise<void>;
}

export interface ProviderTerminalRecorder {
  mark_response_observed(input: {
    readonly request: AuthoritativeModelProviderInvocation;
    readonly event: Extract<
      ModelProviderEvent,
      { event_type: "COMPLETED" | "FAILED" | "THROTTLED" }
    >;
  }): Promise<void>;
  commit_terminal(input: {
    readonly request: AuthoritativeModelProviderInvocation;
    readonly event: Extract<
      ModelProviderEvent,
      { event_type: "COMPLETED" | "FAILED" | "THROTTLED" }
    >;
  }): Promise<void>;
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
  if (
    completion.usage.availability === "AVAILABLE" &&
    completion.usage.input_tokens > request.budget.max_input_tokens
  ) {
    throw new MastraExecutionError(
      "MODEL_INPUT_TOKEN_BUDGET_EXCEEDED",
      false,
      "Model Provider 返回的 Input Token Usage 超过授权预算。",
    );
  }
  if (
    completion.usage.availability === "AVAILABLE" &&
    completion.usage.output_tokens > request.budget.max_output_tokens
  ) {
    throw new MastraExecutionError(
      "MODEL_OUTPUT_TOKEN_BUDGET_EXCEEDED",
      false,
      "Model Provider 返回的 Output Token Usage 超过授权预算。",
    );
  }
  if (
    completion.usage.observed_tool_calls !== observedToolCalls ||
    completion.usage.observed_tool_calls > request.budget.max_tool_calls
  ) {
    throw new MastraExecutionError(
      completion.usage.observed_tool_calls === observedToolCalls
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
        readonly usage:
          | {
              readonly availability: "AVAILABLE";
              readonly source: "PROVIDER_REPORTED";
              readonly input_tokens: number;
              readonly output_tokens: number;
              readonly tool_calls: number;
              readonly unavailable_reason: null;
            }
          | {
              readonly availability: "UNAVAILABLE";
              readonly source: "UNAVAILABLE";
              readonly input_tokens: null;
              readonly output_tokens: null;
              readonly tool_calls: null;
              readonly unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE";
            };
      }
    | {
        readonly event_type: "FAILED";
        readonly reason_code: string;
        readonly retryable: boolean;
        readonly delivery_certainty:
          | "NOT_DISPATCHED"
          | "DISPATCHED_OUTCOME_UNKNOWN"
          | "DISPATCHED_OUTCOME_KNOWN";
      }
    | {
        readonly event_type: "THROTTLED";
        readonly reason_code: "MODEL_PROVIDER_THROTTLED";
        readonly retryable: true;
        readonly delivery_certainty: "DISPATCHED_OUTCOME_KNOWN";
        readonly retry_after_ms: number | null;
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
  dispatchMarked: boolean,
): ModelProviderEvent {
  if (dispatchMarked && isFullyObservedEmptyResponse(error)) {
    return nextSequenceEvent(request, clock, sequence, {
      event_type: "FAILED",
      reason_code: "MODEL_RESPONSE_EMPTY",
      retryable: false,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
    });
  }
  const normalized = normalizeMastraExecutionError(error);
  if (dispatchMarked && normalized.terminal_status === "THROTTLED") {
    return nextSequenceEvent(request, clock, sequence, {
      event_type: "THROTTLED",
      reason_code: "MODEL_PROVIDER_THROTTLED",
      retryable: true,
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      retry_after_ms: normalized.retry_after_ms,
    });
  }
  return nextSequenceEvent(request, clock, sequence, {
    event_type: "FAILED",
    reason_code: normalized.reason_code,
    retryable: normalized.retryable,
    delivery_certainty: dispatchMarked ? "DISPATCHED_OUTCOME_UNKNOWN" : "NOT_DISPATCHED",
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
  readonly #dispatchMarker: ProviderDispatchMarker;
  readonly #authorization:
    | "DIRECT"
    | "PERSISTENT_PERMIT"
    | "SEMANTIC_AUTHORING_PERSISTED"
    | "CERTIFIED_EVALUATION"
    | "LEGACY_TEST_ONLY";
  readonly #terminalRecorder: ProviderTerminalRecorder | undefined;
  readonly #abortSignal: AbortSignal | undefined;

  constructor(options: {
    readonly bridge: ModelExecutionBridge;
    readonly clock?: ModelProviderAdapterClock;
    readonly dispatch_marker: ProviderDispatchMarker;
    readonly authorization:
      | "DIRECT"
      | "PERSISTENT_PERMIT"
      | "SEMANTIC_AUTHORING_PERSISTED"
      | "CERTIFIED_EVALUATION"
      | "LEGACY_TEST_ONLY";
    readonly terminal_recorder?: ProviderTerminalRecorder;
    readonly abort_signal?: AbortSignal;
  }) {
    this.#bridge = options.bridge;
    this.#clock = options.clock ?? systemClock;
    this.#dispatchMarker = options.dispatch_marker;
    this.#authorization = options.authorization;
    this.#terminalRecorder = options.terminal_recorder;
    this.#abortSignal = options.abort_signal;
  }

  async *stream(input: AuthoritativeModelProviderInvocation): AsyncIterable<ModelProviderEvent> {
    if (
      (this.#authorization === "PERSISTENT_PERMIT" &&
        !isAuthoritativePersistedModelProviderInvocation(input)) ||
      (this.#authorization === "SEMANTIC_AUTHORING_PERSISTED" &&
        !isAuthoritativeSemanticAuthoringModelProviderInvocation(input)) ||
      ((this.#authorization === "DIRECT" ||
        this.#authorization === "CERTIFIED_EVALUATION" ||
        this.#authorization === "LEGACY_TEST_ONLY") &&
        !isAuthoritativeModelProviderInvocation(input))
    ) {
      throw new MastraExecutionError(
        "MODEL_PROVIDER_REQUEST_NOT_AUTHORIZED",
        false,
        "Model Provider Adapter 只接受已授权调用。",
      );
    }

    let sequence = 0;
    let dispatchMarked = false;

    const controller = new AbortController();
    const abortFromRun = () => controller.abort();
    if (this.#abortSignal?.aborted) controller.abort();
    this.#abortSignal?.addEventListener("abort", abortFromRun, { once: true });
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
            "INVALID_CHUNK",
            chunkResult.error.issues,
          );
        }
        const chunk = chunkResult.data;
        if (completion) {
          throw new MastraExecutionError(
            "MODEL_STREAM_PROTOCOL_VIOLATION",
            false,
            "Model Stream 在完成标记后仍产生事件。",
            "AFTER_COMPLETION",
          );
        }

        switch (chunk.chunk_type) {
          case "DISPATCH_READY":
            if (dispatchMarked) {
              throw new MastraExecutionError(
                "MODEL_STREAM_PROTOCOL_VIOLATION",
                false,
                "Model Execution Bridge 重复声明 dispatch suspension。",
                "DUPLICATE_DISPATCH",
              );
            }
            await this.#dispatchMarker.mark_dispatched(input);
            dispatchMarked = true;
            yield nextSequenceEvent(input, this.#clock, sequence, { event_type: "STARTED" });
            sequence += 1;
            break;
          case "TEXT_DELTA":
            if (!dispatchMarked) {
              throw new MastraExecutionError(
                "MODEL_STREAM_PROTOCOL_VIOLATION",
                false,
                "Provider 数据不能出现在 durable dispatch marker 之前。",
                "DATA_BEFORE_DISPATCH",
              );
            }
            yield nextSequenceEvent(input, this.#clock, sequence, {
              event_type: "TEXT_DELTA",
              delta: chunk.delta,
            });
            sequence += 1;
            break;
          case "TOOL_CALL_CANDIDATE":
            if (!dispatchMarked) {
              throw new MastraExecutionError(
                "MODEL_STREAM_PROTOCOL_VIOLATION",
                false,
                "Provider Tool Candidate 不能出现在 durable dispatch marker 之前。",
                "TOOL_BEFORE_DISPATCH",
              );
            }
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
                "DUPLICATE_TOOL_ID",
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
            if (!dispatchMarked) {
              throw new MastraExecutionError(
                "MODEL_STREAM_PROTOCOL_VIOLATION",
                false,
                "Provider completion 不能出现在 durable dispatch marker 之前。",
                "COMPLETION_BEFORE_DISPATCH",
              );
            }
            completion = chunk;
            break;
        }
      }

      if (!completion) {
        throw new MastraExecutionError(
          "MODEL_STREAM_PROTOCOL_VIOLATION",
          false,
          "Model Stream 未产生完成标记。",
          "MISSING_COMPLETION",
        );
      }

      assertUsageWithinBudget(input, completion, observedToolCalls);
      const responseHash = await sha256ContentHash({
        output_text: completion.output_text,
        tool_calls: responseToolCalls,
      });
      const completedEvent = nextSequenceEvent(input, this.#clock, sequence, {
        event_type: "COMPLETED",
        output_text: completion.output_text,
        response_hash: responseHash,
        usage:
          completion.usage.availability === "AVAILABLE"
            ? {
                availability: "AVAILABLE",
                source: "PROVIDER_REPORTED",
                input_tokens: completion.usage.input_tokens,
                output_tokens: completion.usage.output_tokens,
                tool_calls: completion.usage.observed_tool_calls,
                unavailable_reason: null,
              }
            : {
                availability: "UNAVAILABLE",
                source: "UNAVAILABLE",
                input_tokens: null,
                output_tokens: null,
                tool_calls: null,
                unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE",
              },
      });
      await this.#terminalRecorder?.mark_response_observed({
        request: input,
        event: completedEvent as Extract<ModelProviderEvent, { event_type: "COMPLETED" }>,
      });
      await this.#terminalRecorder?.commit_terminal({
        request: input,
        event: completedEvent as Extract<ModelProviderEvent, { event_type: "COMPLETED" }>,
      });
      yield completedEvent;
    } catch (error) {
      const normalizedError =
        error instanceof InvocationTimeoutError
          ? new MastraExecutionError(
              "MODEL_PROVIDER_TIMEOUT",
              true,
              "Model Provider 调用超过授权超时预算。",
            )
          : error;
      const diagnostic = modelProtocolDiagnostic(normalizedError);
      if (diagnostic) {
        // Diagnostics must not alter failure semantics even if the log sink fails.
        try {
          console.warn(
            JSON.stringify({
              event: "model_stream_protocol_diagnostic",
              request_id: input.request_id,
              run_id: input.run_id,
              response_schema_version: input.response_schema_version,
              dispatch_marked: dispatchMarked,
              ...diagnostic,
            }),
          );
        } catch {
          /* Terminal handling remains authoritative. */
        }
      }
      const terminalEvent = failedEvent(
        input,
        this.#clock,
        sequence,
        normalizedError,
        dispatchMarked,
      );
      await this.#terminalRecorder?.mark_response_observed({
        request: input,
        event: terminalEvent as Extract<ModelProviderEvent, { event_type: "FAILED" | "THROTTLED" }>,
      });
      await this.#terminalRecorder?.commit_terminal({
        request: input,
        event: terminalEvent as Extract<ModelProviderEvent, { event_type: "FAILED" | "THROTTLED" }>,
      });
      yield terminalEvent;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      controller.abort();
      this.#abortSignal?.removeEventListener("abort", abortFromRun);
      if (iterator?.return) {
        void iterator.return().catch(() => undefined);
      }
    }
  }
}
