import {
  type AuthoritativeModelProviderInvocation,
  authorizeModelProviderInvocation,
  type ModelProviderEvent,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { MastraExecutionError } from "../src/mastra/errors.js";
import type { ModelExecutionBridge, ModelExecutionChunk } from "../src/mastra/execution-bridge.js";
import { MastraModelProviderAdapter } from "../src/mastra/model-provider-adapter.js";
import { makeAvailableProfile, modelFixtureIds, modelFixtureScope } from "./model-fixtures.js";

const observedAt = new Date("2026-07-25T12:00:00.000Z");
const contentHash = `sha256:${"b".repeat(64)}` as const;

async function makeInvocation(input?: {
  readonly tool_allowlist?: readonly string[];
  readonly max_tool_calls?: number;
  readonly max_input_tokens?: number;
  readonly max_output_tokens?: number;
  readonly timeout_ms?: number;
}): Promise<AuthoritativeModelProviderInvocation> {
  const profile = await makeAvailableProfile({
    provider: "openai",
    model_id: "gpt-5.4-mini",
  });
  return authorizeModelProviderInvocation(
    {
      schema_version: "1.0.0",
      request_id: modelFixtureIds.request,
      attempt_id: modelFixtureIds.attempt,
      scope: modelFixtureScope,
      run_id: modelFixtureIds.run,
      provider: profile.provider,
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      model_id: profile.model_id,
      task_ref: {
        artifact_id: modelFixtureIds.task,
        artifact_type: "ResearchBrief",
        ...modelFixtureScope,
        run_id: modelFixtureIds.run,
        revision: 1,
        content_hash: contentHash,
      },
      context_refs: [],
      messages: [{ role: "user", content: "分析已授权数据。" }],
      tool_allowlist: input?.tool_allowlist ?? [],
      response_schema_version: "1.0.0",
      budget: {
        timeout_ms: input?.timeout_ms ?? 1_000,
        max_input_tokens: input?.max_input_tokens ?? 100,
        max_output_tokens: input?.max_output_tokens ?? 100,
        max_tool_calls: input?.max_tool_calls ?? 0,
      },
    },
    async () => profile,
  );
}

function bridgeFrom(chunks: readonly ModelExecutionChunk[]): ModelExecutionBridge {
  return {
    async *stream() {
      yield { chunk_type: "DISPATCH_READY" };
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createAdapter(bridge: ModelExecutionBridge): MastraModelProviderAdapter {
  return new MastraModelProviderAdapter({
    bridge,
    clock: {
      now: () => observedAt,
    },
    dispatch_marker: {
      mark_dispatched: async () => undefined,
    },
    authorization: "LEGACY_TEST_ONLY",
  });
}

async function collect(
  adapter: MastraModelProviderAdapter,
  invocation: AuthoritativeModelProviderInvocation,
): Promise<ModelProviderEvent[]> {
  const events: ModelProviderEvent[] = [];
  for await (const event of adapter.stream(invocation)) {
    events.push(event);
  }
  return events;
}

describe("MastraModelProviderAdapter", () => {
  it.each(["WHITESPACE", "NON_JSON"] as const)(
    "does not promote copied %s diagnostics into known response evidence",
    async (textState) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const events = await collect(
          createAdapter({
            async *stream() {
              yield { chunk_type: "DISPATCH_READY" };
              throw new MastraExecutionError(
                "MODEL_STREAM_PROTOCOL_VIOLATION",
                false,
                "private",
                "AUTO_RESPONSE_INVALID_JSON",
                undefined,
                {
                  finish_reason: "stop",
                  text_state: textState,
                  text_utf8_bytes: 216,
                  streamed_text_utf8_bytes: 216,
                  text_delta_chunks: 216,
                  observed_tool_calls: 0,
                  output_tokens: 216,
                },
              );
            },
          }),
          await makeInvocation(),
        );
        expect(events.at(-1)).toMatchObject({
          event_type: "FAILED",
          reason_code: "MODEL_STREAM_PROTOCOL_VIOLATION",
          retryable: false,
          delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
        });
        expect(events.filter((event) => event.event_type === "COMPLETED")).toEqual([]);
      } finally {
        warning.mockRestore();
      }
    },
  );

  it.each([false, true])(
    "keeps one fail-closed terminal with a raw-free diagnostic (sink throws: %s)",
    async (sinkThrows) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {
        if (sinkThrows) throw new Error("private log sink failure");
      });
      try {
        const invocation = await makeInvocation();
        const events = await collect(
          createAdapter(
            bridgeFrom([
              {
                chunk_type: "TEXT_DELTA",
                delta: 99,
                "secret-key": "private response",
              } as unknown as ModelExecutionChunk,
            ]),
          ),
          invocation,
        );
        expect(events.map((event) => event.event_type)).toEqual(["STARTED", "FAILED"]);
        expect(events.at(-1)).toMatchObject({
          retryable: false,
          delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
        });
        expect(warning).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(String(warning.mock.calls[0]?.[0]));
        expect(logged).toMatchObject({
          event: "model_stream_protocol_diagnostic",
          run_id: invocation.run_id,
          request_id: invocation.request_id,
          stage: "INVALID_CHUNK",
          dispatch_marked: true,
        });
        expect(logged.issues).toContainEqual({ code: "invalid_type", path: ["delta"] });
        expect(JSON.stringify(logged)).not.toMatch(/private|secret|99/);
        expect(JSON.stringify(events)).not.toContain("protocol_diagnostic");
      } finally {
        warning.mockRestore();
      }
    },
  );

  it("emits correlated, strictly increasing events with one terminal", async () => {
    const invocation = await makeInvocation({
      tool_allowlist: ["semantic-query@1"],
      max_tool_calls: 1,
    });
    const events = await collect(
      createAdapter(
        bridgeFrom([
          { chunk_type: "TEXT_DELTA", delta: "结论" },
          {
            chunk_type: "TOOL_CALL_CANDIDATE",
            tool_call_id: "call-1",
            tool_name: "semantic-query@1",
            arguments: { metric: "revenue" },
          },
          {
            chunk_type: "COMPLETED",
            output_text: "结论",
            usage: {
              availability: "AVAILABLE",
              input_tokens: 12,
              output_tokens: 2,
              observed_tool_calls: 1,
            },
          },
        ]),
      ),
      invocation,
    );

    expect(events.map((event) => event.event_type)).toEqual([
      "STARTED",
      "TEXT_DELTA",
      "TOOL_CALL_CANDIDATE",
      "COMPLETED",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(
      events.filter((event) => event.event_type === "COMPLETED" || event.event_type === "FAILED"),
    ).toHaveLength(1);
    expect(events.every((event) => event.request_id === invocation.request_id)).toBe(true);
  });

  it("completes successfully with explicit UNAVAILABLE usage when Provider omits counts", async () => {
    const invocation = await makeInvocation();
    const events = await collect(
      createAdapter(
        bridgeFrom([
          {
            chunk_type: "COMPLETED",
            output_text: "仍可提交的结果",
            usage: {
              availability: "UNAVAILABLE",
              reason: "PROVIDER_DID_NOT_REPORT_USAGE",
              observed_tool_calls: 0,
            },
          },
        ]),
      ),
      invocation,
    );

    expect(events.at(-1)).toMatchObject({
      event_type: "COMPLETED",
      usage: {
        availability: "UNAVAILABLE",
        source: "UNAVAILABLE",
        input_tokens: null,
        output_tokens: null,
        tool_calls: null,
        unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE",
      },
    });
  });

  it("does not resume the transport bridge until durable dispatch marking succeeds", async () => {
    const invocation = await makeInvocation();
    let networkCalls = 0;
    let releaseMarker: (() => void) | undefined;
    const marker = new Promise<void>((resolve) => {
      releaseMarker = resolve;
    });
    const adapter = new MastraModelProviderAdapter({
      bridge: {
        async *stream() {
          yield { chunk_type: "DISPATCH_READY" };
          networkCalls += 1;
          yield {
            chunk_type: "COMPLETED",
            output_text: "ok",
            usage: {
              availability: "AVAILABLE",
              input_tokens: 1,
              output_tokens: 1,
              observed_tool_calls: 0,
            },
          };
        },
      },
      clock: { now: () => observedAt },
      dispatch_marker: { mark_dispatched: async () => marker },
      authorization: "LEGACY_TEST_ONLY",
    });
    const iterator = adapter.stream(invocation)[Symbol.asyncIterator]();
    const firstEventPromise = iterator.next();
    await Promise.resolve();
    expect(networkCalls).toBe(0);
    releaseMarker?.();
    const first = await firstEventPromise;
    expect(first.value).toMatchObject({ event_type: "STARTED" });
    expect(networkCalls).toBe(0);
    const second = await iterator.next();
    expect(second.value).toMatchObject({ event_type: "COMPLETED" });
    expect(networkCalls).toBe(1);
  });

  it("keeps network calls at zero when durable dispatch marking fails", async () => {
    const invocation = await makeInvocation();
    let networkCalls = 0;
    const adapter = new MastraModelProviderAdapter({
      bridge: {
        async *stream() {
          yield { chunk_type: "DISPATCH_READY" };
          networkCalls += 1;
        },
      },
      dispatch_marker: {
        mark_dispatched: async () => {
          throw new Error("db unavailable");
        },
      },
      authorization: "LEGACY_TEST_ONLY",
    });
    const events = await collect(adapter, invocation);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "FAILED",
      delivery_certainty: "NOT_DISPATCHED",
    });
    expect(networkCalls).toBe(0);
  });

  it("fails closed when the model requests a tool outside the allowlist", async () => {
    const invocation = await makeInvocation({
      tool_allowlist: ["semantic-query@1"],
      max_tool_calls: 1,
    });
    const events = await collect(
      createAdapter(
        bridgeFrom([
          {
            chunk_type: "TOOL_CALL_CANDIDATE",
            tool_call_id: "call-1",
            tool_name: "network-fetch@1",
            arguments: { url: "https://example.invalid" },
          },
        ]),
      ),
      invocation,
    );

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_TOOL_NOT_ALLOWED",
      retryable: false,
      sequence: 1,
    });
  });

  it("stops before emitting a tool call beyond the authorized budget", async () => {
    const invocation = await makeInvocation({
      tool_allowlist: ["semantic-query@1"],
      max_tool_calls: 1,
    });
    const events = await collect(
      createAdapter(
        bridgeFrom([
          {
            chunk_type: "TOOL_CALL_CANDIDATE",
            tool_call_id: "call-1",
            tool_name: "semantic-query@1",
            arguments: {},
          },
          {
            chunk_type: "TOOL_CALL_CANDIDATE",
            tool_call_id: "call-2",
            tool_name: "semantic-query@1",
            arguments: {},
          },
        ]),
      ),
      invocation,
    );

    expect(events.map((event) => event.event_type)).toEqual([
      "STARTED",
      "TOOL_CALL_CANDIDATE",
      "FAILED",
    ]);
    expect(events[2]).toMatchObject({
      reason_code: "MODEL_TOOL_CALL_BUDGET_EXCEEDED",
      sequence: 2,
    });
  });

  it("rejects completion usage beyond the output token budget", async () => {
    const invocation = await makeInvocation({ max_output_tokens: 3 });
    const events = await collect(
      createAdapter(
        bridgeFrom([
          {
            chunk_type: "COMPLETED",
            output_text: "超出预算",
            usage: {
              availability: "AVAILABLE",
              input_tokens: 1,
              output_tokens: 4,
              observed_tool_calls: 0,
            },
          },
        ]),
      ),
      invocation,
    );

    expect(events[1]).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_OUTPUT_TOKEN_BUDGET_EXCEEDED",
      retryable: false,
    });
  });

  it("does not emit COMPLETED when the bridge produces data after completion", async () => {
    const invocation = await makeInvocation();
    const events = await collect(
      createAdapter(
        bridgeFrom([
          {
            chunk_type: "COMPLETED",
            output_text: "候选",
            usage: {
              availability: "AVAILABLE",
              input_tokens: 1,
              output_tokens: 1,
              observed_tool_calls: 0,
            },
          },
          { chunk_type: "TEXT_DELTA", delta: "迟到数据" },
        ]),
      ),
      invocation,
    );

    expect(events.map((event) => event.event_type)).toEqual(["STARTED", "FAILED"]);
    expect(events[1]).toMatchObject({
      reason_code: "MODEL_STREAM_PROTOCOL_VIOLATION",
      sequence: 1,
    });
  });

  it("rejects duplicate tool call identifiers as a protocol violation", async () => {
    const invocation = await makeInvocation({
      tool_allowlist: ["semantic-query@1"],
      max_tool_calls: 2,
    });
    const repeatedCall = {
      chunk_type: "TOOL_CALL_CANDIDATE",
      tool_call_id: "call-repeated",
      tool_name: "semantic-query@1",
      arguments: {},
    } as const;
    const events = await collect(
      createAdapter(bridgeFrom([repeatedCall, repeatedCall])),
      invocation,
    );

    expect(events.map((event) => event.event_type)).toEqual([
      "STARTED",
      "TOOL_CALL_CANDIDATE",
      "FAILED",
    ]);
    expect(events[2]).toMatchObject({
      reason_code: "MODEL_STREAM_PROTOCOL_VIOLATION",
      retryable: false,
    });
  });

  it("maps malformed bridge chunks to a non-retryable protocol terminal", async () => {
    const invocation = await makeInvocation();
    const bridge: ModelExecutionBridge = {
      async *stream() {
        yield {
          chunk_type: "TEXT_DELTA",
          delta: "",
        } as ModelExecutionChunk;
      },
    };
    const events = await collect(createAdapter(bridge), invocation);

    expect(events[0]).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_STREAM_PROTOCOL_VIOLATION",
      retryable: false,
    });
  });

  it("returns a retryable timeout terminal and aborts the bridge", async () => {
    const invocation = await makeInvocation({ timeout_ms: 10 });
    let aborted = false;
    const bridge: ModelExecutionBridge = {
      async *stream({ signal }) {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    };

    const events = await collect(createAdapter(bridge), invocation);

    expect(events[0]).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_PROVIDER_TIMEOUT",
      retryable: true,
    });
    expect(aborted).toBe(true);
  });

  it("normalizes unknown provider errors without leaking secrets", async () => {
    const invocation = await makeInvocation();
    const bridge: ModelExecutionBridge = {
      async *stream() {
        yield* [];
        throw new Error("Authorization: Bearer sk-private-value");
      },
    };

    const events = await collect(createAdapter(bridge), invocation);
    const serialized = JSON.stringify(events);

    expect(events[0]).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_PROVIDER_EXECUTION_FAILED",
      retryable: true,
    });
    expect(serialized).not.toContain("sk-private-value");
    expect(serialized).not.toContain("Authorization");
  });

  it("classifies an explicit provider 429 as THROTTLED with known delivery", async () => {
    const invocation = await makeInvocation();
    const bridge: ModelExecutionBridge = {
      async *stream() {
        yield { chunk_type: "DISPATCH_READY" };
        throw {
          [Symbol.for("vercel.ai.error.AI_APICallError")]: true,
          statusCode: 429,
          isRetryable: true,
          retryAfterMs: 2_000,
          responseBody: "secret provider body",
        };
      },
    };
    const events = await collect(createAdapter(bridge), invocation);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event_type: "THROTTLED",
      reason_code: "MODEL_PROVIDER_THROTTLED",
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      retry_after_ms: 2_000,
    });
    expect(JSON.stringify(events)).not.toContain("secret provider body");
  });

  it("rejects runtime casts that did not pass invocation authorization", async () => {
    const invocation = await makeInvocation();
    const forged = { ...invocation } as AuthoritativeModelProviderInvocation;

    await expect(
      collect(
        createAdapter(
          bridgeFrom([
            {
              chunk_type: "COMPLETED",
              output_text: "",
              usage: {
                availability: "AVAILABLE",
                input_tokens: 0,
                output_tokens: 0,
                observed_tool_calls: 0,
              },
            },
          ]),
        ),
        forged,
      ),
    ).rejects.toMatchObject({
      code: "MODEL_PROVIDER_REQUEST_NOT_AUTHORIZED",
    });
  });

  it("production authorization rejects even a legacy-authorized request without persistent permit", async () => {
    const legacyInvocation = await makeInvocation();
    let bridgeCalls = 0;
    const adapter = new MastraModelProviderAdapter({
      bridge: {
        async *stream() {
          bridgeCalls += 1;
          yield { chunk_type: "DISPATCH_READY" };
        },
      },
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "PERSISTENT_PERMIT",
    });
    await expect(collect(adapter, legacyInvocation)).rejects.toMatchObject({
      code: "MODEL_PROVIDER_REQUEST_NOT_AUTHORIZED",
    });
    expect(bridgeCalls).toBe(0);
  });
});
