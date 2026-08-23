import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQAStore } from "@/lib/qa-store";

const ids = {
  workspace: "00000000-0000-4000-8000-00000000aa11",
  principal: "00000000-0000-4000-8000-000000001001",
  oldConversation: "00000000-0000-4000-8000-00000000c101",
  newConversation: "00000000-0000-4000-8000-00000000c102",
  datasource: "00000000-0000-4000-8000-00000000d101",
  model: "30000000-0000-4000-8000-000000000003",
} as const;

const now = "2026-08-16T00:00:00.000Z";

function conversation(id: string, messageCount: number) {
  return {
    id,
    title: "收入分析",
    dataSourceId: ids.datasource,
    modelProfileId: ids.model,
    resourceVersion: 3,
    messageCount,
    sortOrder: 0,
    lifecycle: "ACTIVE" as const,
    liveState: "IDLE" as const,
    unreadCompleted: false,
    createdAt: now,
    updatedAt: now,
  };
}

function responseConversation(id: string) {
  return {
    schema_version: "workspace-conversation@1.0.0",
    workspace_id: ids.workspace,
    conversation_id: id,
    owner_principal_id: ids.principal,
    title: "收入分析",
    datasource_id: ids.datasource,
    model_id: ids.model,
    model_profile_id: ids.model,
    resource_version: 1,
    message_count: 0,
    created_at: now,
    updated_at: now,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {
    location: {
      pathname: `/w/${ids.workspace}/qa`,
      href: `http://localhost:3000/w/${ids.workspace}/qa`,
    },
    history: { replaceState: vi.fn() },
  });
  useQAStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Q&A conversation resource switching", () => {
  it("creates an empty conversation when a resource is chosen before the first message", async () => {
    useQAStore.setState({
      resourceCatalog: {
        schema_version: "qa-resource-catalog@1.0.0",
        models: [
          {
            model_profile_id: ids.model,
            config_version: 1,
            profile_version: "model-profile@1",
            provider: "deepseek",
            model_id: "deepseek-v4-flash",
            display_name: "DeepSeek",
            certification_receipt_ref: {
              artifact_id: "30000000-0000-4000-8000-000000000004",
              artifact_type: "ModelCertificationReceipt",
              app_id: "00000000-0000-4000-8000-00000000da01",
              tenant_id: ids.workspace,
              environment: "test",
              run_id: "30000000-0000-4000-8000-000000000005",
              revision: 1,
              content_hash: `sha256:${"a".repeat(64)}`,
            },
            effective_context_ceiling_tokens: 16_000,
            effective_output_ceiling_tokens: 4_000,
            readiness: "AVAILABLE",
            selectable: true,
          },
        ],
        datasources: [
          {
            datasource_id: ids.datasource,
            display_name: "Falcon",
            type: "postgresql",
            status: "ACTIVE",
            selectable: true,
          },
        ],
      },
      resourceCatalogState: "ready",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: responseConversation(ids.newConversation) }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useQAStore.getState().updateActiveConversationResources({
      modelProfileId: ids.model,
    });

    expect(useQAStore.getState().activeConversationId).toBe(ids.newConversation);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.body))).toMatchObject({
      datasource_id: ids.datasource,
      model_profile_id: ids.model,
    });
  });

  it("activates a replacement conversation without mutating the frozen history", async () => {
    const old = conversation(ids.oldConversation, 4);
    useQAStore.setState({
      conversations: [old],
      activeConversationId: old.id,
      messages: [
        {
          id: "local-message",
          conversationId: old.id,
          role: "user",
          content: "旧问题",
          type: "text",
          createdAt: now,
        },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            kind: "CREATED_REPLACEMENT",
            conversation: responseConversation(ids.newConversation),
            replaced_id: ids.oldConversation,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useQAStore.getState().updateActiveConversationResources({
      modelProfileId: ids.model,
      dataSourceId: ids.datasource,
    });

    const state = useQAStore.getState();
    expect(state.activeConversationId).toBe(ids.oldConversation);
    expect(fetchMock).not.toHaveBeenCalled();

    await useQAStore.getState().updateActiveConversationResources({
      modelProfileId: "30000000-0000-4000-8000-000000000005",
    });

    const replaced = useQAStore.getState();
    expect(replaced.activeConversationId).toBe(ids.newConversation);
    expect(replaced.messages).toEqual([]);
    expect(replaced.conversations).toContainEqual(old);
    expect(replaced.resourceNotice).toContain("原对话与执行证据保持不变");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      schema_version: "qa-conversation-resource-switch@1.0.0",
      expected_resource_version: 3,
      datasource_id: ids.datasource,
      model_profile_id: "30000000-0000-4000-8000-000000000005",
    });
  });

  it("surfaces resource catalog failures instead of silently falling back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "模型目录暂时不可用" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await useQAStore.getState().loadResourceCatalog();

    expect(useQAStore.getState()).toMatchObject({
      resourceCatalog: null,
      resourceCatalogState: "error",
      resourceError: "模型目录暂时不可用",
    });
  });
});
