import { buildAgentDispatchDeferredReceipt, sha256ContentHash } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessage } from "@/components/qa/chat-message";
import { ApiRequestError, createQaRun, DeferredRunAdmissionError } from "@/lib/api-client";
import { useQAStore } from "@/lib/qa-store";

const workspaceId = "00000000-0000-4000-8000-00000000aa11";
const conversationId = "00000000-0000-4000-8000-00000000cc11";
const datasourceId = "00000000-0000-4000-8000-00000000dd11";
const modelId = "00000000-0000-4000-8000-00000000ee11";
const runId = "00000000-0000-4000-8000-00000000ff11";

async function deferredReceipt() {
  return buildAgentDispatchDeferredReceipt({
    kind: "DEFERRED",
    schema_version: "agent-dispatch-deferred-receipt@1.0.0",
    run_id: runId,
    question_class: "ATTRIBUTION",
    reason_code: "ATTRIBUTION_RUNTIME_NOT_READY",
    required_capabilities: ["attribution.acceptance@1.0.0"],
    policy_version: "adaptive-routing@1.0.0",
    capability_snapshot_hash: await sha256ContentHash({ attribution: false }),
  });
}

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { pathname: `/w/${workspaceId}/qa`, href: `http://localhost/w/${workspaceId}/qa` },
    history: { replaceState: vi.fn() },
  });
  useQAStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("adaptive DEFERRED admission", () => {
  it("verifies the receipt hash and throws a typed non-Run result", async () => {
    const receipt = await deferredReceipt();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ dispatch: receipt }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(createQaRun("为什么利润下降", conversationId, workspaceId)).rejects.toMatchObject({
      name: "DeferredRunAdmissionError",
      receipt,
    });
  });

  it("fails closed on a forged receipt instead of treating it as BLOCKED authority", async () => {
    const receipt = await deferredReceipt();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ dispatch: { ...receipt, reason_code: "ROOT_ONLY_DEFER_DATA" } }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );

    const promise = createQaRun("为什么利润下降", conversationId, workspaceId);
    await expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    await expect(promise).rejects.not.toBeInstanceOf(DeferredRunAdmissionError);
  });

  it("keeps the question, shows BLOCKED details and never opens an SSE request", async () => {
    const receipt = await deferredReceipt();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ dispatch: receipt }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    useQAStore.setState({
      conversations: [
        {
          id: conversationId,
          title: "归因问题",
          dataSourceId: datasourceId,
          modelProfileId: modelId,
          resourceVersion: 1,
          messageCount: 0,
          createdAt: "2026-08-22T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
        },
      ],
      activeConversationId: conversationId,
    });

    await expect(useQAStore.getState().sendMessage("为什么利润下降")).resolves.toBe(true);

    const state = useQAStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.activeRunId).toBeNull();
    expect(state.connection).toBe("closed");
    expect(state.error).toBeUndefined();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: "user", content: "为什么利润下降" });
    expect(state.messages[1]).toMatchObject({ role: "agent", deferredAdmission: receipt });

    const blocked = state.messages[1];
    expect(blocked).toBeDefined();
    if (!blocked) throw new Error("blocked message missing");
    const html = renderToStaticMarkup(<ChatMessage message={blocked} />);
    expect(html).toContain("BLOCKED · 请求未进入运行");
    expect(html).toContain("ATTRIBUTION_RUNTIME_NOT_READY");
    expect(html).toContain("attribution.acceptance@1.0.0");
    expect(html).not.toContain("Subagent");
    expect(html).not.toContain("API 请求失败 (409)");
  });
});
