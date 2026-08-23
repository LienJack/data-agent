import { describe, expect, it, vi } from "vitest";
import type { ProviderCredentialedSmoke } from "../src/models/certification.js";
import {
  createLiveProviderCredentialedSmoke,
  runProviderTransportSmokeForTesting,
} from "../src/models/credentialed-smoke.js";
import { getModelProviderBinding, probeModelProvider } from "../src/models/index.js";
import { modelFixtureScope } from "./model-fixtures.js";

const returnedModelId = "provider-returned-model-id";
const credentialMarker = "unit-test-credential-marker";

function openAIUsage() {
  return {
    input_tokens: 4,
    output_tokens: 2,
  };
}

function openAIResponse(content: readonly unknown[]) {
  return {
    id: "resp-credentialed-smoke",
    created_at: 1,
    model: returnedModelId,
    output: content,
    usage: openAIUsage(),
  };
}

function eventStream(events: readonly unknown[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function createNoNetworkOpenAITransport() {
  const bodies: unknown[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const body = JSON.parse(
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "{}",
    ) as Record<string, unknown>;
    bodies.push(body);

    switch (bodies.length) {
      case 1:
        return new Response(
          JSON.stringify(
            openAIResponse([
              {
                type: "message",
                role: "assistant",
                id: "msg-request",
                content: [
                  {
                    type: "output_text",
                    text: "CREDENTIAL_SMOKE_REQUEST_OK",
                    annotations: [],
                  },
                ],
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 2:
        return new Response(
          JSON.stringify(
            openAIResponse([
              {
                type: "message",
                role: "assistant",
                id: "msg-structured",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ credentialed_smoke: "structured-ok" }),
                    annotations: [],
                  },
                ],
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 3:
        return new Response(
          JSON.stringify(
            openAIResponse([
              {
                type: "function_call",
                call_id: "call-credentialed-smoke",
                name: "credentialed_smoke_tool",
                arguments: JSON.stringify({ probe: "tool-ok" }),
                id: "fc-credentialed-smoke",
              },
            ]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      case 4:
        return eventStream([
          {
            type: "response.output_text.delta",
            item_id: "msg-stream",
            delta: "CREDENTIAL_STREAM_",
          },
          {
            type: "response.output_text.delta",
            item_id: "msg-stream",
            delta: "OK",
          },
          {
            type: "response.completed",
            response: {
              id: "resp-stream",
              created_at: 1,
              model: returnedModelId,
              output: [],
              usage: openAIUsage(),
            },
          },
        ]);
      case 5:
        return new Response(
          JSON.stringify({
            error: {
              message: "credentialed-smoke-remote-secret-marker",
              type: "authentication_error",
              code: "invalid_api_key",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      default:
        throw new Error("Unexpected provider request.");
    }
  });

  return { fetch, bodies };
}

function createForcedToolChatTransport(modelId: string) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const body = JSON.parse(
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "{}",
    ) as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 3) {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-tool-smoke",
          object: "chat.completion",
          created: 1,
          model: modelId,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-tool-smoke",
                    type: "function",
                    function: {
                      name: "credentialed_smoke_tool",
                      arguments: JSON.stringify({ probe: "tool-ok" }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        error: { message: "safe test failure", type: "invalid_request_error" },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  });
  return { fetch, bodies };
}

describe("显式 Provider Credentialed Smoke", () => {
  it("注入 Fetch 可离线覆盖真实 SDK 的请求、结构化输出、强制 Tool、流与脱敏路径", async () => {
    const binding = getModelProviderBinding("openai");
    const transport = createNoNetworkOpenAITransport();

    const observation = await runProviderTransportSmokeForTesting(
      {
        binding,
        credential: credentialMarker,
      },
      { fetch: transport.fetch },
    );

    expect(observation).toEqual({
      evidence_scope: "INJECTED_TRANSPORT_TEST_ONLY",
      observed_model_id: returnedModelId,
      checks: {
        request_shape: true,
        structured_output: true,
        tool_calling: true,
        streaming: true,
        error_normalization: true,
      },
    });
    expect(transport.fetch).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(transport.bodies[1])).toContain("credentialed_smoke");
    expect(JSON.stringify(transport.bodies[2])).toContain("credentialed_smoke_tool");
    expect(JSON.stringify(transport.bodies[2])).toContain("tool_choice");
    expect(transport.bodies[3]).toMatchObject({ stream: true });
    expect(
      transport.bodies
        .slice(0, 4)
        .every((body) => (body as Record<string, unknown>).max_output_tokens === 256),
    ).toBe(true);
    expect(JSON.stringify(observation)).not.toContain(credentialMarker);
    expect(JSON.stringify(observation)).not.toContain("credentialed-smoke-remote-secret-marker");
    expect(observation).not.toHaveProperty("actual_model_id");
  });

  it("注入 Transport 既不获得 Live Authority，也不能驱动 Probe 生成 PASS Draft", async () => {
    const binding = getModelProviderBinding("openai");
    const transport = createNoNetworkOpenAITransport();
    const testOnlySmoke = vi.fn(async (input: Parameters<ProviderCredentialedSmoke>[0]) => {
      const observation = await runProviderTransportSmokeForTesting(input, {
        fetch: transport.fetch,
      });
      return {
        actual_model_id: observation.observed_model_id ?? binding.default_model_id,
        checks: observation.checks,
      };
    });

    const probe = await probeModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => credentialMarker,
      smoke: testOnlySmoke,
    });

    expect(probe.certification_status).toBe("UNAVAILABLE");
    expect(probe.reason_code).toBe("CREDENTIAL_SMOKE_NOT_AUTHORIZED");
    expect(testOnlySmoke).not.toHaveBeenCalled();
    expect(transport.fetch).not.toHaveBeenCalled();
  });

  it.each(["deepseek", "kimi"] as const)(
    "%s 强制工具调用会在请求边界关闭 thinking",
    async (provider) => {
      const binding = getModelProviderBinding(provider);
      const transport = createForcedToolChatTransport(binding.default_model_id);

      const observation = await runProviderTransportSmokeForTesting(
        { binding, credential: credentialMarker },
        { fetch: transport.fetch },
      );

      expect(observation.checks.tool_calling).toBe(true);
      expect(transport.bodies[2]).toMatchObject({ thinking: { type: "disabled" } });
    },
  );

  it("包装 Live Executor 会丢失 WeakSet Authority，且不会触发网络请求", async () => {
    const binding = getModelProviderBinding("openai");
    const liveSmoke = createLiveProviderCredentialedSmoke();
    const wrappedSmoke = vi.fn<ProviderCredentialedSmoke>((input) => liveSmoke(input));

    const probe = await probeModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => credentialMarker,
      smoke: wrappedSmoke,
    });

    expect(probe.certification_status).toBe("UNAVAILABLE");
    expect(probe.reason_code).toBe("CREDENTIAL_SMOKE_NOT_AUTHORIZED");
    expect(wrappedSmoke).not.toHaveBeenCalled();
  });

  it("Live Executor 只有显式创建才产生，创建本身不访问网络", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const smoke = createLiveProviderCredentialedSmoke();

    expect(smoke).toBeTypeOf("function");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
