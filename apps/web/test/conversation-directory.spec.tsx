import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationDirectory } from "@/components/qa/conversation-directory";
import { WorkspaceI18nProvider } from "@/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const directoryState = vi.hoisted(() => ({
  folders: [] as unknown[],
  conversations: [] as unknown[],
  activeConversationId: null as string | null,
  directoryView: "active" as "active" | "archived" | "trash",
  directoryQuery: "",
  ungroupedName: null as string | null,
  expandedFolderIds: [] as string[],
  pendingDirectoryIds: [] as string[],
  store: {
    selectConversation: vi.fn(),
    setDirectoryQuery: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    renameUngrouped: vi.fn(),
    renameConversation: vi.fn(),
    moveConversation: vi.fn(),
    deleteFolder: vi.fn(),
    trashConversation: vi.fn(),
    reorderConversation: vi.fn(),
    archiveConversation: vi.fn(),
    restoreConversation: vi.fn(),
    restoreConversationFromTrash: vi.fn(),
    toggleFolderExpanded: vi.fn(),
    reorderFolder: vi.fn(),
    archiveFolder: vi.fn(),
    restoreFolder: vi.fn(),
    setDirectoryView: vi.fn(),
  },
}));

vi.mock("@/lib/qa-store", () => ({
  useQAActiveConversationId: () => directoryState.activeConversationId,
  useQAConversations: () => directoryState.conversations,
  useQADirectoryQuery: () => directoryState.directoryQuery,
  useQADirectoryView: () => directoryState.directoryView,
  useQAUngroupedName: () => directoryState.ungroupedName,
  useQAExpandedFolderIds: () => directoryState.expandedFolderIds,
  useQAFolders: () => directoryState.folders,
  useQAPendingDirectoryIds: () => directoryState.pendingDirectoryIds,
  useQAStore: () => directoryState.store,
}));

const folderId = "40000000-0000-4000-8000-000000000001";
const now = "2026-08-22T00:00:00.000Z";

function conversation(index: number) {
  return {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `研究对话 ${index}`,
    resourceVersion: 1,
    messageCount: index,
    folderId,
    sortOrder: index,
    lifecycle: "ACTIVE" as const,
    liveState: index === 1 ? ("RUNNING" as const) : ("IDLE" as const),
    unreadCompleted: index === 2,
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(() => {
  directoryState.folders = [];
  directoryState.conversations = [];
  directoryState.directoryView = "active";
  directoryState.directoryQuery = "";
  directoryState.ungroupedName = null;
  directoryState.expandedFolderIds = [];
  directoryState.pendingDirectoryIds = [];
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ConversationDirectory", () => {
  it("renders one folder level, five default rows and keyboard-native disclosure/menu controls", () => {
    directoryState.folders = [
      {
        schema_version: "workspace-conversation-folder@1.0.0",
        workspace_id: "40000000-0000-4000-8000-000000000010",
        folder_id: folderId,
        owner_principal_id: "40000000-0000-4000-8000-000000000011",
        name: "深度调研",
        sort_order: 0,
        resource_version: 1,
        archived_at: null,
        created_at: now,
        updated_at: now,
      },
    ];
    directoryState.conversations = Array.from({ length: 7 }, (_, index) => conversation(index + 1));

    const html = renderToStaticMarkup(
      <WorkspaceI18nProvider>
        <ConversationDirectory qaHref="/w/workspace/qa" />
      </WorkspaceI18nProvider>,
    );

    expect(html).toContain("深度调研");
    expect(html).toContain("研究对话 5");
    expect(html).not.toContain("研究对话 6");
    expect(html).toContain("展开其余 2 个对话");
    expect(html).toContain("管理文件夹：深度调研");
    expect(html).toContain("管理对话：研究对话 1");
    expect(html).toContain("<summary");
    expect(html).toContain('role="tree"');
    expect(html).toContain('role="treeitem"');
  });

  it("shows the authoritative trash countdown and restore-only action", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));
    directoryState.directoryView = "trash";
    directoryState.conversations = [
      {
        ...conversation(1),
        folderId: undefined,
        lifecycle: "TRASH",
        deletedAt: "2026-08-01T00:00:00.000Z",
        purgeAfter: "2026-08-31T00:00:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(
      <WorkspaceI18nProvider>
        <ConversationDirectory qaHref="/w/workspace/qa" />
      </WorkspaceI18nProvider>,
    );

    expect(html).toContain("9 天后清理");
    expect(html).toContain("从回收站恢复");
    expect(html).not.toContain("移到回收站");
  });

  it("keeps conversations visible when their folder is outside the current lifecycle view", () => {
    directoryState.directoryView = "archived";
    directoryState.conversations = [
      {
        ...conversation(1),
        lifecycle: "ARCHIVED",
        archivedAt: now,
      },
    ];

    const html = renderToStaticMarkup(
      <WorkspaceI18nProvider>
        <ConversationDirectory qaHref="/w/workspace/qa" />
      </WorkspaceI18nProvider>,
    );

    expect(html).toContain("未分类");
    expect(html).toContain("研究对话 1");
    expect(html).toContain("恢复到对话");
  });

  it("lets the workspace rename the ungrouped category", () => {
    directoryState.ungroupedName = "待整理";
    directoryState.conversations = [{ ...conversation(1), folderId: undefined }];

    const html = renderToStaticMarkup(
      <WorkspaceI18nProvider>
        <ConversationDirectory qaHref="/w/workspace/qa" />
      </WorkspaceI18nProvider>,
    );

    expect(html).toContain("待整理");
    expect(html).toContain("管理分类：待整理");
    expect(html).toContain("重命名");
  });
});
