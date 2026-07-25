import {
  type AuthoritativeModelProviderInvocation,
  authorizeModelProviderInvocation,
  type ModelProviderEvent,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
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
              input_tokens: 12,
              output_tokens: 2,
              tool_calls: 1,
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
              input_tokens: 1,
              output_tokens: 4,
              tool_calls: 0,
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
              input_tokens: 1,
              output_tokens: 1,
              tool_calls: 0,
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

    expect(events[1]).toMatchObject({
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

    expect(events[1]).toMatchObject({
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

    expect(events[1]).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_PROVIDER_EXECUTION_FAILED",
      retryable: true,
    });
    expect(serialized).not.toContain("sk-private-value");
    expect(serialized).not.toContain("Authorization");
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
                input_tokens: 0,
                output_tokens: 0,
                tool_calls: 0,
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
});
