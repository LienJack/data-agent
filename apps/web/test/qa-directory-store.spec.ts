import { verifyWorkspaceConversationDirectoryCommand } from "@data-agent/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQAStore } from "@/lib/qa-store";

const ids = {
  workspace: "30000000-0000-4000-8000-000000000001",
  principal: "30000000-0000-4000-8000-000000000002",
  folder: "30000000-0000-4000-8000-000000000003",
  conversation: "30000000-0000-4000-8000-000000000004",
  datasource: "30000000-0000-4000-8000-000000000005",
  model: "30000000-0000-4000-8000-000000000006",
} as const;

const now = "2026-08-22T01:00:00.000Z";

function page(title = "订单分析") {
  return {
    schema_version: "workspace-conversation-directory-page@1.0.0",
    workspace_id: ids.workspace,
    view: "active",
    folders: [
      {
        schema_version: "workspace-conversation-folder@1.0.0",
        workspace_id: ids.workspace,
        folder_id: ids.folder,
        owner_principal_id: ids.principal,
        name: "研究",
        sort_order: 0,
        resource_version: 1,
        archived_at: null,
        created_at: now,
        updated_at: now,
      },
    ],
    conversations: [
      {
        schema_version: "workspace-conversation@2.0.0",
        workspace_id: ids.workspace,
        conversation_id: ids.conversation,
        owner_principal_id: ids.principal,
        title,
        datasource_id: ids.datasource,
        model_id: ids.model,
        model_profile_id: ids.model,
        resource_version: 3,
        message_count: 2,
        folder_id: ids.folder,
        sort_order: 0,
        lifecycle: "ACTIVE",
        archived_at: null,
        deleted_at: null,
        purge_after: null,
        live_state: "COMPLETED",
        unread_completed: true,
        search_snippet: null,
        created_at: now,
        updated_at: now,
      },
    ],
    next_cursor: null,
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

describe("Q&A private directory store", () => {
  it("accepts only the strict server directory snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: page() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await useQAStore.getState().loadConversations();

    expect(useQAStore.getState()).toMatchObject({
      activeConversationId: ids.conversation,
      folders: [{ folder_id: ids.folder, owner_principal_id: ids.principal }],
      conversations: [
        {
          id: ids.conversation,
          folderId: ids.folder,
          lifecycle: "ACTIVE",
          liveState: "COMPLETED",
          unreadCompleted: true,
        },
      ],
    });
  });

  it("hashes a rename command and reloads only after the commit succeeds", async () => {
    useQAStore.setState({
      conversations: [
        {
          id: ids.conversation,
          title: "订单分析",
          dataSourceId: ids.datasource,
          modelProfileId: ids.model,
          resourceVersion: 3,
          messageCount: 2,
          folderId: ids.folder,
          sortOrder: 0,
          lifecycle: "ACTIVE",
          liveState: "IDLE",
          unreadCompleted: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      activeConversationId: ids.conversation,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              schema_version: "workspace-conversation-directory-command-result@1.0.0",
              operation_id: "30000000-0000-4000-8000-000000000010",
              action: "CONVERSATION_RENAME",
              command_hash: `sha256:${"a".repeat(64)}`,
              replayed: false,
              folder: null,
              conversation: null,
              affected_conversation_ids: [ids.conversation],
              committed_at: now,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: page("订单趋势") }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      useQAStore.getState().renameConversation(ids.conversation, "订单趋势"),
    ).resolves.toBe(true);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const command = await verifyWorkspaceConversationDirectoryCommand(
      JSON.parse(String(request.body)),
    );
    expect(command).toMatchObject({
      action: "CONVERSATION_RENAME",
      conversation_id: ids.conversation,
      expected_resource_version: 3,
      title: "订单趋势",
    });
    expect(useQAStore.getState().conversations[0]?.title).toBe("订单趋势");
    expect(useQAStore.getState().pendingDirectoryIds).toEqual([]);
  });

  it("preserves selection and committed snapshot when active Run blocks trash", async () => {
    useQAStore.setState({
      conversations: [
        {
          id: ids.conversation,
          title: "运行中",
          resourceVersion: 7,
          messageCount: 1,
          sortOrder: 0,
          lifecycle: "ACTIVE",
          liveState: "RUNNING",
          unreadCompleted: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      activeConversationId: ids.conversation,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN",
              message: "运行中的对话不能移到回收站。",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(useQAStore.getState().trashConversation(ids.conversation)).resolves.toBe(false);
    expect(useQAStore.getState()).toMatchObject({
      activeConversationId: ids.conversation,
      conversations: [{ id: ids.conversation, lifecycle: "ACTIVE" }],
      pendingDirectoryIds: [],
    });
    expect(useQAStore.getState().error).toContain("CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN");
  });

  it("ignores a stale active response after the user switches to archived", async () => {
    let resolveActive!: (response: Response) => void;
    const delayedActive = new Promise<Response>((resolve) => {
      resolveActive = resolve;
    });
    const archivedPage = {
      ...page("已归档"),
      view: "archived",
      folders: [],
      conversations: page("已归档").conversations.map((conversation) => ({
        ...conversation,
        lifecycle: "ARCHIVED",
        archived_at: now,
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => delayedActive)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: archivedPage }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    const initialLoad = useQAStore.getState().loadConversations();
    await useQAStore.getState().setDirectoryView("archived");
    resolveActive(
      new Response(JSON.stringify({ data: page("过期结果") }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await initialLoad;

    expect(useQAStore.getState()).toMatchObject({
      directoryView: "archived",
      conversations: [{ title: "已归档", lifecycle: "ARCHIVED" }],
    });
  });
});
