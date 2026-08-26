"use client";

import type { PublicRunEvent, QaInspectorTarget } from "@data-agent/contracts/runs";
import type {
  QaResourceCatalog,
  WorkspaceConversation,
  WorkspaceConversationDirectoryView,
  WorkspaceConversationFolder,
  WorkspaceConversationMessage,
  WorkspaceConversationV2,
} from "@data-agent/contracts/workspaces";
import {
  buildWorkspaceConversationDirectoryCommand,
  qaConversationResourceSwitchResultSchema,
  qaResourceCatalogSchema,
  workspaceConversationDirectoryCommandResultSchema,
  workspaceConversationDirectoryPageSchema,
} from "@data-agent/contracts/workspaces";
import { create } from "zustand";
import {
  commandRun,
  createQaRun,
  fetchConversationTrajectory,
  getRun,
  resolveWorkspaceId,
} from "./api-client";
import { fetchDataSources } from "./datasource-api";
import type { DataSourceConnection } from "./datasource-types";
import { answerText, mergePublicRunEvents, resumableRunFromReplay } from "./qa-event-assembler";
import { replaceQAInspectorTargetInBrowser } from "./qa-inspector-target";
import { createQaRunStream, type QaRunStreamSession } from "./qa-run-stream";
import type {
  Conversation,
  CreateConversationInput,
  Message,
  QAView,
  TrajectoryFocus,
  UpdateConversationResourcesInput,
} from "./qa-types";
import type { RunConnectionState, RunProjection } from "./run-projection";

const FALCON24_GATE_CLAIM_KEY = "falcon24-e1-browser-submit-claim";
const FALCON24_GATE_CONSUMED_KEY = "falcon24-e1-browser-submit-consumed";

function readFalcon24GateClaim(question: string, conversationId: string) {
  const raw = window.sessionStorage.getItem(FALCON24_GATE_CLAIM_KEY);
  if (!raw) return undefined;
  window.sessionStorage.removeItem(FALCON24_GATE_CLAIM_KEY);
  const candidate = JSON.parse(raw) as {
    schema_version?: unknown;
    question?: unknown;
    conversation_id?: unknown;
    idempotency_key?: unknown;
    acceptance_fence?: {
      authority_kind?: unknown;
      qualification_id?: unknown;
      campaign_id?: unknown;
      attempt_id?: unknown;
      run_id?: unknown;
      claim_fence_token?: unknown;
    };
  };
  const fence = candidate.acceptance_fence;
  const exactAuthority =
    (fence?.authority_kind === "QUALIFICATION" && fence.qualification_id === "E1-Q1") ||
    (fence?.authority_kind === "FINAL_CAMPAIGN" && fence.campaign_id === "E1-C1");
  if (
    candidate.schema_version !== "falcon24-e1-browser-submit-claim@1.0.0" ||
    candidate.question !== question ||
    candidate.conversation_id !== conversationId ||
    typeof candidate.idempotency_key !== "string" ||
    !exactAuthority ||
    typeof fence?.attempt_id !== "string" ||
    typeof fence.run_id !== "string" ||
    typeof fence.claim_fence_token !== "string"
  ) {
    throw new Error("FALCON24_BROWSER_GATE_CLAIM_INVALID");
  }
  return candidate as {
    idempotency_key: string;
    acceptance_fence:
      | {
          authority_kind: "QUALIFICATION";
          qualification_id: "E1-Q1";
          attempt_id: string;
          run_id: string;
          claim_fence_token: string;
        }
      | {
          authority_kind: "FINAL_CAMPAIGN";
          campaign_id: "E1-C1";
          attempt_id: string;
          run_id: string;
          claim_fence_token: string;
        };
  };
}

/**
 * Q&A 状态管理。
 *
 * 管理对话列表、消息、数据源和模型选择状态。
 */

interface QAState {
  /** 对话列表 */
  conversations: Conversation[];
  folders: WorkspaceConversationFolder[];
  directoryView: WorkspaceConversationDirectoryView;
  directoryQuery: string;
  directoryNextCursor: string | null;
  ungroupedName: string | null;
  expandedFolderIds: string[];
  pendingDirectoryIds: string[];
  /** 当前选中的对话 ID */
  activeConversationId: string | null;
  /** 当前对话的消息列表 */
  messages: Message[];
  /** 当前对话从持久化 Run 事件恢复出的同源过程与轨迹。 */
  events: PublicRunEvent[];
  view: QAView;
  trajectoryFocus: TrajectoryFocus | null;
  inspectorTarget: QaInspectorTarget | null;
  inspectorTriggerId: string | null;
  inspectorWidth: number;
  connection: RunConnectionState;
  /** 可用数据源列表 */
  dataSources: DataSourceConnection[];
  /** 服务端安全资源目录，是 Composer 唯一可选资源来源。 */
  resourceCatalog: QaResourceCatalog | null;
  resourceCatalogState: "idle" | "loading" | "ready" | "empty" | "error";
  resourceSwitching: boolean;
  resourceError: string | undefined;
  resourceNotice: string | undefined;
  activeRunId: string | null;
  /** 加载状态 */
  loading: boolean;
  /** 消息发送中 */
  sending: boolean;
  /** 错误信息 */
  error: string | undefined;
}

interface SelectConversationOptions {
  /** URL bootstrap keeps the exact query until replay validation restores it. */
  preserveInspectorQuery?: boolean;
}

interface QAActions {
  /** 加载对话列表 */
  loadConversations: () => Promise<void>;
  setDirectoryView: (view: WorkspaceConversationDirectoryView) => Promise<void>;
  setDirectoryQuery: (query: string) => Promise<void>;
  renameUngrouped: (name: string) => boolean;
  hydrateUngroupedName: () => void;
  toggleFolderExpanded: (folderId: string) => void;
  createFolder: (name: string) => Promise<boolean>;
  renameFolder: (folderId: string, name: string) => Promise<boolean>;
  reorderFolder: (folderId: string, sortOrder: number) => Promise<boolean>;
  archiveFolder: (folderId: string) => Promise<boolean>;
  restoreFolder: (folderId: string) => Promise<boolean>;
  deleteFolder: (folderId: string) => Promise<boolean>;
  renameConversation: (conversationId: string, title: string) => Promise<boolean>;
  reorderConversation: (conversationId: string, sortOrder: number) => Promise<boolean>;
  moveConversation: (conversationId: string, folderId: string | null) => Promise<boolean>;
  archiveConversation: (conversationId: string) => Promise<boolean>;
  restoreConversation: (conversationId: string) => Promise<boolean>;
  trashConversation: (conversationId: string) => Promise<boolean>;
  restoreConversationFromTrash: (conversationId: string) => Promise<boolean>;
  /** 创建新对话 */
  createConversation: (input: CreateConversationInput) => Promise<Conversation | null>;
  /** 删除对话 */
  deleteConversation: (id: string) => Promise<void>;
  /** 选中对话 */
  selectConversation: (id: string, options?: SelectConversationOptions) => Promise<void>;
  /** 加载消息 */
  loadMessages: (conversationId: string) => Promise<void>;
  loadTrajectory: (conversationId: string) => Promise<void>;
  setView: (view: QAView) => void;
  openTrajectory: (focus: TrajectoryFocus) => void;
  openConversation: (focus: TrajectoryFocus) => void;
  selectInspector: (target: QaInspectorTarget, triggerId: string) => void;
  closeInspector: () => void;
  restoreInspector: (target: QaInspectorTarget | null) => void;
  setInspectorWidth: (width: number) => void;
  hydrateInspectorWidth: () => void;
  /** 发送消息 */
  sendMessage: (
    content: string,
    files?: readonly Readonly<{ file_id: string; revision: number; revision_hash: string }>[],
  ) => Promise<boolean>;
  stopMessage: () => Promise<void>;
  loadResourceCatalog: () => Promise<void>;
  /** 加载数据源列表 */
  loadDataSources: () => Promise<void>;
  /** 更新当前对话的数据源或模型绑定 */
  updateActiveConversationResources: (input: UpdateConversationResourcesInput) => Promise<void>;
  /** 清除错误 */
  clearError: () => void;
  /** 清除当前工作空间的全部客户端状态 */
  reset: () => void;
  /** 获取当前对话 */
  getActiveConversation: () => Conversation | null;
}

export type QAStore = QAState & QAActions;

const initialState: QAState = {
  conversations: [],
  folders: [],
  directoryView: "active",
  directoryQuery: "",
  directoryNextCursor: null,
  ungroupedName: null,
  expandedFolderIds: [],
  pendingDirectoryIds: [],
  activeConversationId: null,
  messages: [],
  events: [],
  view: "conversation",
  trajectoryFocus: null,
  inspectorTarget: null,
  inspectorTriggerId: null,
  inspectorWidth: 360,
  connection: "idle",
  dataSources: [],
  resourceCatalog: null,
  resourceCatalogState: "idle",
  resourceSwitching: false,
  resourceError: undefined,
  resourceNotice: undefined,
  activeRunId: null,
  loading: false,
  sending: false,
  error: undefined,
};

function workspaceQaPath(path = ""): string {
  const workspaceId = resolveWorkspaceId();
  if (!workspaceId) throw new Error("请先选择工作空间");
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/qa${path}`;
}

function ungroupedNameStorageKey(): string | null {
  const workspaceId = resolveWorkspaceId();
  return workspaceId ? `data-agent.qa-ungrouped-name:${workspaceId}` : null;
}

function conversationFromContract(
  value: WorkspaceConversation | WorkspaceConversationV2,
): Conversation {
  const directory = value.schema_version === "workspace-conversation@2.0.0" ? value : null;
  return {
    id: value.conversation_id,
    title: value.title,
    dataSourceId: value.datasource_id ?? undefined,
    modelProfileId: value.model_profile_id ?? value.model_id ?? undefined,
    resourceVersion: value.resource_version ?? 1,
    messageCount: value.message_count,
    folderId: directory?.folder_id ?? undefined,
    sortOrder: directory?.sort_order ?? 0,
    lifecycle: directory?.lifecycle ?? "ACTIVE",
    archivedAt: directory?.archived_at ?? undefined,
    deletedAt: directory?.deleted_at ?? undefined,
    purgeAfter: directory?.purge_after ?? undefined,
    liveState: directory?.live_state ?? "IDLE",
    unreadCompleted: directory?.unread_completed ?? false,
    searchSnippet: directory?.search_snippet ?? undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function messageFromContract(value: WorkspaceConversationMessage): Message {
  return {
    id: value.message_id,
    conversationId: value.conversation_id,
    role: value.role,
    content: value.content,
    type: value.type,
    runId: value.run_id ?? undefined,
    metadata: value.metadata,
    createdAt: value.created_at,
  };
}

function directoryCommandBase(action: string) {
  const nonce = crypto.randomUUID();
  return {
    schema_version: "workspace-conversation-directory-command@1.0.0" as const,
    operation_id: nonce,
    idempotency_key: `directory:${action.toLocaleLowerCase()}:${nonce}`,
    action,
  };
}

async function executeDirectoryCommand(
  draft: unknown,
  pendingIds: readonly string[],
): Promise<boolean> {
  useQAStore.setState((state) => ({
    error: undefined,
    pendingDirectoryIds: [...new Set([...state.pendingDirectoryIds, ...pendingIds])],
  }));
  try {
    const command = await buildWorkspaceConversationDirectoryCommand(draft);
    const response = await fetch(workspaceQaPath("/directory/commands"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const raw: unknown = await response.json();
    if (!response.ok) {
      const candidate = raw as {
        readonly error?: { readonly code?: unknown; readonly message?: unknown };
      };
      const code =
        typeof candidate.error?.code === "string"
          ? candidate.error.code
          : "QA_DIRECTORY_COMMAND_FAILED";
      const message =
        typeof candidate.error?.message === "string" ? candidate.error.message : "目录操作失败";
      throw new Error(`${code} · ${message}`);
    }
    workspaceConversationDirectoryCommandResultSchema.parse(
      (raw as { readonly data?: unknown }).data,
    );
    await useQAStore.getState().loadConversations();
    return true;
  } catch (error) {
    useQAStore.setState({ error: error instanceof Error ? error.message : "目录操作失败" });
    return false;
  } finally {
    useQAStore.setState((state) => ({
      pendingDirectoryIds: state.pendingDirectoryIds.filter((id) => !pendingIds.includes(id)),
    }));
  }
}

function replaceMessage(messages: Message[], id: string, patch: Partial<Message>): Message[] {
  return messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
}

function terminalAnswer(projection: RunProjection | null): string {
  const summaries = projection?.reports?.map((report) => report.summary).filter(Boolean) ?? [];
  if (summaries.length > 0) return summaries.join("\n\n");
  if (projection?.status === "FAILED") return "分析执行失败，请展开执行过程查看失败节点。";
  if (projection?.status === "CANCELLED") return "分析已取消。";
  return "分析执行完成。";
}

function replayTerminalAnswer(events: readonly PublicRunEvent[], runId: string): string | null {
  const answer = answerText(events, runId);
  if (answer) return answer;
  const terminal = events.findLast(
    (event): event is Extract<PublicRunEvent, { type: "terminal" }> =>
      event.run_id === runId && event.type === "terminal",
  );
  if (!terminal) return null;
  if (terminal.payload.status === "FAILED") return "分析执行失败，请展开执行过程查看失败节点。";
  if (terminal.payload.status === "CANCELLED") return "分析已取消。";
  return "分析执行完成。";
}

let activeStreamSession: QaRunStreamSession | null = null;
let directoryRequestGeneration = 0;

export function acceptsRunStreamFrame(
  activeConversationId: string | null,
  activeRunId: string | null,
  expectedConversationId: string,
  expectedRunId: string,
): boolean {
  return activeConversationId === expectedConversationId && activeRunId === expectedRunId;
}

async function attachReplayRunStream(
  runId: string,
  workspaceId: string,
  conversationId: string,
  initialCursor: number,
): Promise<void> {
  if (activeStreamSession && useQAStore.getState().activeRunId === runId) return;
  activeStreamSession?.abort();
  if (useQAStore.getState().activeConversationId !== conversationId) return;
  useQAStore.setState({ activeRunId: runId, connection: "connecting" });
  const session = createQaRunStream({
    initial_cursor: initialCursor,
    onConnection: (connection) => useQAStore.setState({ connection }),
    onEvent: (event) => {
      useQAStore.setState((state) => {
        if (
          !acceptsRunStreamFrame(
            state.activeConversationId,
            state.activeRunId,
            conversationId,
            runId,
          )
        ) {
          return {};
        }
        const events = mergePublicRunEvents(state.events, [event]);
        const content = answerText(events, runId);
        return {
          events,
          messages: state.messages.map((message) =>
            message.role === "agent" && message.runId === runId
              ? { ...message, content: content || message.content }
              : message,
          ),
        };
      });
    },
    run_id: runId,
    workspace_id: workspaceId,
  });
  activeStreamSession = session;
  try {
    const result = await session.run();
    if (result.exhausted) {
      useQAStore.setState({ connection: "reconnecting" });
      return;
    }
    if (
      result.terminal &&
      useQAStore.getState().activeConversationId === conversationId &&
      useQAStore.getState().activeRunId === runId
    ) {
      useQAStore.setState({ activeRunId: null, connection: "closed" });
    }
  } finally {
    if (activeStreamSession === session) activeStreamSession = null;
  }
}

export const useQAStore = create<QAStore>((set, get) => ({
  ...initialState,

  loadConversations: async () => {
    const generation = ++directoryRequestGeneration;
    get().hydrateUngroupedName();
    set({ loading: true, error: undefined });
    try {
      const state = get();
      const parameters = new URLSearchParams({ view: state.directoryView, limit: "50" });
      if (state.directoryQuery.trim()) parameters.set("q", state.directoryQuery.trim());
      const response = await fetch(workspaceQaPath(`/conversations?${parameters.toString()}`));
      if (!response.ok) throw new Error("加载对话列表失败");
      const json: unknown = await response.json();
      const page = workspaceConversationDirectoryPageSchema.parse(
        (json as { readonly data?: unknown }).data,
      );
      if (generation !== directoryRequestGeneration) return;
      const conversations = page.conversations.map(conversationFromContract);
      const activeStillVisible = conversations.some(
        (conversation) => conversation.id === get().activeConversationId,
      );
      if (!activeStillVisible && get().directoryView !== "active") {
        activeStreamSession?.abort();
        activeStreamSession = null;
      }
      set({
        conversations,
        folders: page.folders,
        directoryNextCursor: page.next_cursor,
        activeConversationId:
          activeStillVisible || get().directoryView !== "active"
            ? get().activeConversationId
            : (conversations[0]?.id ?? null),
        loading: false,
      });
    } catch (err) {
      if (generation !== directoryRequestGeneration) return;
      set({ error: err instanceof Error ? err.message : "加载对话列表失败", loading: false });
    }
  },

  setDirectoryView: async (view) => {
    set({ directoryView: view, directoryNextCursor: null });
    await get().loadConversations();
  },

  setDirectoryQuery: async (query) => {
    set({ directoryQuery: query, directoryNextCursor: null });
    await get().loadConversations();
  },

  renameUngrouped: (name) => {
    const normalized = name.trim();
    if (!normalized || normalized.length > 80) return false;
    set({ ungroupedName: normalized });
    try {
      const storageKey = ungroupedNameStorageKey();
      if (storageKey) window.localStorage.setItem(storageKey, normalized);
    } catch {
      // A blocked display preference must not affect the conversation directory.
    }
    return true;
  },

  hydrateUngroupedName: () => {
    try {
      const storageKey = ungroupedNameStorageKey();
      const stored = storageKey ? window.localStorage.getItem(storageKey)?.trim() : null;
      set({ ungroupedName: stored && stored.length <= 80 ? stored : null });
    } catch {
      set({ ungroupedName: null });
    }
  },

  toggleFolderExpanded: (folderId) => {
    set((state) => ({
      expandedFolderIds: state.expandedFolderIds.includes(folderId)
        ? state.expandedFolderIds.filter((id) => id !== folderId)
        : [...state.expandedFolderIds, folderId],
    }));
  },

  createFolder: async (name) =>
    executeDirectoryCommand(
      {
        ...directoryCommandBase("FOLDER_CREATE"),
        folder_id: crypto.randomUUID(),
        name,
        sort_order: 0,
      },
      [],
    ),

  renameFolder: async (folderId, name) => {
    const folder = get().folders.find((candidate) => candidate.folder_id === folderId);
    if (!folder) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("FOLDER_RENAME"),
        folder_id: folderId,
        expected_resource_version: folder.resource_version,
        name,
      },
      [folderId],
    );
  },

  reorderFolder: async (folderId, sortOrder) => {
    const folder = get().folders.find((candidate) => candidate.folder_id === folderId);
    if (!folder) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("FOLDER_REORDER"),
        folder_id: folderId,
        expected_resource_version: folder.resource_version,
        sort_order: sortOrder,
      },
      [folderId],
    );
  },

  archiveFolder: async (folderId) => {
    const folder = get().folders.find((candidate) => candidate.folder_id === folderId);
    if (!folder) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("FOLDER_ARCHIVE"),
        folder_id: folderId,
        expected_resource_version: folder.resource_version,
      },
      [folderId],
    );
  },

  restoreFolder: async (folderId) => {
    const folder = get().folders.find((candidate) => candidate.folder_id === folderId);
    if (!folder) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("FOLDER_RESTORE"),
        folder_id: folderId,
        expected_resource_version: folder.resource_version,
      },
      [folderId],
    );
  },

  deleteFolder: async (folderId) => {
    const folder = get().folders.find((candidate) => candidate.folder_id === folderId);
    if (!folder) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("FOLDER_DELETE"),
        folder_id: folderId,
        expected_resource_version: folder.resource_version,
        confirmed: true,
      },
      [folderId],
    );
  },

  renameConversation: async (conversationId, title) => {
    const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("CONVERSATION_RENAME"),
        conversation_id: conversationId,
        expected_resource_version: conversation.resourceVersion,
        title,
      },
      [conversationId],
    );
  },

  reorderConversation: async (conversationId, sortOrder) => {
    const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("CONVERSATION_REORDER"),
        conversation_id: conversationId,
        expected_resource_version: conversation.resourceVersion,
        sort_order: sortOrder,
      },
      [conversationId],
    );
  },

  moveConversation: async (conversationId, folderId) => {
    const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("CONVERSATION_MOVE"),
        conversation_id: conversationId,
        expected_resource_version: conversation.resourceVersion,
        folder_id: folderId,
      },
      [conversationId, ...(folderId ? [folderId] : [])],
    );
  },

  archiveConversation: async (conversationId) => {
    const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("CONVERSATION_ARCHIVE"),
        conversation_id: conversationId,
        expected_resource_version: conversation.resourceVersion,
      },
      [conversationId],
    );
  },

  restoreConversation: async (conversationId) => {
    const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("CONVERSATION_RESTORE"),
        conversation_id: conversationId,
        expected_resource_version: conversation.resourceVersion,
      },
      [conversationId],
    );
  },

  trashConversation: async (conversationId) => {
    const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("CONVERSATION_TRASH"),
        conversation_id: conversationId,
        expected_resource_version: conversation.resourceVersion,
        confirmed: true,
      },
      [conversationId],
    );
  },

  restoreConversationFromTrash: async (conversationId) => {
    const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return false;
    return executeDirectoryCommand(
      {
        ...directoryCommandBase("CONVERSATION_RESTORE_FROM_TRASH"),
        conversation_id: conversationId,
        expected_resource_version: conversation.resourceVersion,
      },
      [conversationId],
    );
  },

  createConversation: async (input) => {
    activeStreamSession?.abort();
    activeStreamSession = null;
    set({ error: undefined });
    try {
      const catalog = get().resourceCatalog;
      const dataSourceId =
        input.dataSourceId ??
        catalog?.datasources.find((source) => source.selectable)?.datasource_id;
      const modelProfileId =
        input.modelProfileId ?? catalog?.models.find((model) => model.selectable)?.model_profile_id;
      const response = await fetch(workspaceQaPath("/conversations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema_version: "workspace-conversation-create@1.0.0",
          title: input.title,
          datasource_id: dataSourceId ?? null,
          model_id: modelProfileId ?? null,
          ...(modelProfileId ? { model_profile_id: modelProfileId } : {}),
        }),
      });
      if (!response.ok) throw new Error("创建对话失败");
      const json = (await response.json()) as { data: WorkspaceConversation };
      const conversation = conversationFromContract(json.data);
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: conversation.id,
        messages: [],
        events: [],
        view: "conversation",
        trajectoryFocus: null,
        inspectorTarget: null,
        inspectorTriggerId: null,
        resourceNotice: undefined,
      }));
      return conversation;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "创建对话失败" });
      return null;
    }
  },

  deleteConversation: async (id) => {
    const trashed = await get().trashConversation(id);
    if (trashed && get().activeConversationId === id) {
      activeStreamSession?.abort();
      activeStreamSession = null;
      set({
        activeConversationId: null,
        messages: [],
        events: [],
        trajectoryFocus: null,
        inspectorTarget: null,
        inspectorTriggerId: null,
      });
    }
  },

  selectConversation: async (id, options) => {
    activeStreamSession?.abort();
    activeStreamSession = null;
    if (!options?.preserveInspectorQuery) replaceQAInspectorTargetInBrowser(null, id);
    set({
      activeConversationId: id,
      messages: [],
      events: [],
      trajectoryFocus: null,
      inspectorTarget: null,
      inspectorTriggerId: null,
    });
    await get().loadMessages(id);
  },

  loadMessages: async (conversationId) => {
    set({ loading: true, error: undefined });
    try {
      const [response, trajectory] = await Promise.all([
        fetch(workspaceQaPath(`/conversations/${encodeURIComponent(conversationId)}/messages`)),
        fetchConversationTrajectory(conversationId),
      ]);
      if (!response.ok) throw new Error("加载消息失败");
      const json = (await response.json()) as { data: WorkspaceConversationMessage[] };
      if (get().activeConversationId === conversationId) {
        const messages = json.data.map(messageFromContract);
        for (const runId of new Set(trajectory.events.map((event) => event.run_id))) {
          if (messages.some((message) => message.role === "agent" && message.runId === runId))
            continue;
          const content = replayTerminalAnswer(trajectory.events, runId);
          if (!content) continue;
          const terminal = trajectory.events.findLast(
            (event) => event.run_id === runId && event.type === "terminal",
          );
          messages.push({
            id: `replay-agent-${runId}`,
            conversationId,
            role: "agent",
            content,
            type: "text",
            runId,
            createdAt: terminal?.occurred_at ?? new Date().toISOString(),
          });
        }
        const resumable = resumableRunFromReplay(trajectory.events);
        if (
          resumable &&
          !messages.some((message) => message.role === "agent" && message.runId === resumable.runId)
        ) {
          messages.push({
            id: `replay-agent-${resumable.runId}`,
            conversationId,
            role: "agent",
            content: answerText(trajectory.events, resumable.runId),
            type: "text",
            runId: resumable.runId,
            createdAt:
              trajectory.events.find((event) => event.run_id === resumable.runId)?.occurred_at ??
              new Date().toISOString(),
          });
        }
        messages.sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        );
        set({
          messages,
          events: trajectory.events,
          loading: false,
        });
        if (resumable) {
          const workspaceId = resolveWorkspaceId();
          if (workspaceId) {
            void attachReplayRunStream(
              resumable.runId,
              workspaceId,
              conversationId,
              resumable.cursor,
            );
          }
        }
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载消息失败", loading: false });
    }
  },

  loadTrajectory: async (conversationId) => {
    try {
      const trajectory = await fetchConversationTrajectory(conversationId);
      if (get().activeConversationId === conversationId) set({ events: trajectory.events });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载轨迹失败" });
    }
  },

  setView: (view) => set({ view }),

  openTrajectory: (focus) => {
    set({ view: "trajectory", trajectoryFocus: focus });
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "trajectory");
      url.searchParams.set("run", focus.runId);
      url.searchParams.set("event", String(focus.sequence));
      window.history.replaceState(null, "", url);
    }
  },

  openConversation: (focus) => {
    set({ view: "conversation", trajectoryFocus: focus });
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "conversation");
      url.searchParams.set("run", focus.runId);
      url.searchParams.set("event", String(focus.sequence));
      window.history.replaceState(null, "", url);
    }
  },

  selectInspector: (target, triggerId) => {
    const state = get();
    const runBelongsToConversation =
      state.events.some((event) => event.run_id === target.run_id) ||
      state.messages.some((message) => message.runId === target.run_id);
    if (!state.activeConversationId || !runBelongsToConversation) {
      set({ error: "INSPECTOR_RUN_NOT_IN_ACTIVE_CONVERSATION" });
      return;
    }
    replaceQAInspectorTargetInBrowser(target, state.activeConversationId);
    set({ inspectorTarget: target, inspectorTriggerId: triggerId });
  },

  closeInspector: () => {
    const triggerId = get().inspectorTriggerId;
    replaceQAInspectorTargetInBrowser(null, get().activeConversationId);
    set({ inspectorTarget: null, inspectorTriggerId: null });
    if (triggerId && typeof document !== "undefined") {
      requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
    }
  },

  restoreInspector: (target) => {
    const state = get();
    const knownRun =
      target === null ||
      state.events.some((event) => event.run_id === target.run_id) ||
      state.messages.some((message) => message.runId === target.run_id);
    const restored = knownRun ? target : null;
    replaceQAInspectorTargetInBrowser(restored, state.activeConversationId);
    set({
      inspectorTarget: restored,
      inspectorTriggerId: null,
      ...(knownRun ? {} : { error: "INSPECTOR_RUN_NOT_IN_ACTIVE_CONVERSATION" }),
    });
  },

  setInspectorWidth: (width) => {
    const inspectorWidth = Math.min(520, Math.max(320, Math.round(width)));
    set({ inspectorWidth });
    try {
      window.localStorage.setItem("data-agent.qa-inspector-width", String(inspectorWidth));
    } catch {
      // Layout preference failure must not affect Run or Inspector authority.
    }
  },

  hydrateInspectorWidth: () => {
    try {
      const stored = Number(window.localStorage.getItem("data-agent.qa-inspector-width"));
      if (Number.isFinite(stored)) set({ inspectorWidth: Math.min(520, Math.max(320, stored)) });
    } catch {
      // Keep the contract default when browser storage is unavailable.
    }
  },

  loadResourceCatalog: async () => {
    set({ resourceCatalogState: "loading", resourceError: undefined });
    try {
      const response = await fetch(workspaceQaPath("/resources"));
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "加载模型和数据源失败");
      }
      const json = (await response.json()) as { data: unknown };
      const catalog = qaResourceCatalogSchema.parse(json.data);
      const selectableModels = catalog.models.filter((model) => model.selectable);
      const selectableDatasources = catalog.datasources.filter((source) => source.selectable);
      set({
        resourceCatalog: catalog,
        resourceCatalogState:
          selectableModels.length > 0 && selectableDatasources.length > 0 ? "ready" : "empty",
      });
    } catch (error) {
      set({
        resourceCatalog: null,
        resourceCatalogState: "error",
        resourceError: error instanceof Error ? error.message : "加载模型和数据源失败",
      });
    }
  },

  sendMessage: async (content, files = []) => {
    const state = get();
    let conversationId = state.activeConversationId;

    // 如果没有活跃对话，自动创建一个
    if (!conversationId) {
      const defaultDatasource = state.resourceCatalog?.datasources.find(
        (source) => source.selectable,
      );
      const defaultModel = state.resourceCatalog?.models.find((model) => model.selectable);
      if (!defaultDatasource || !defaultModel) {
        set({ error: "发送消息前请先选择可运行模型和可用数据源" });
        return false;
      }
      const conv = await get().createConversation({
        title: content.slice(0, 50) + (content.length > 50 ? "..." : ""),
        dataSourceId: defaultDatasource.datasource_id,
        modelProfileId: defaultModel.model_profile_id,
      });
      if (!conv) return false;
      conversationId = conv.id;
    }

    activeStreamSession?.abort();
    activeStreamSession = null;
    set({ sending: true, error: undefined });

    // 添加用户消息到本地
    const userMessage: Message = {
      id: `local-${Date.now()}`,
      conversationId,
      role: "user",
      content,
      type: "text",
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMessage] }));

    let runAccepted = false;
    let finalAnswerProjected = false;
    try {
      const workspaceId = resolveWorkspaceId();
      const activeConversation = get().conversations.find((item) => item.id === conversationId);
      if (!workspaceId) throw new Error("请先选择工作空间");
      if (!activeConversation?.dataSourceId) throw new Error("发送消息前请先选择数据源");
      if (!activeConversation.modelProfileId) throw new Error("发送消息前请先选择模型");

      // 服务端在一个事务中从 Conversation 冻结资源、写入用户消息并创建 Run。
      const gateClaim = readFalcon24GateClaim(content, conversationId);
      const run = await createQaRun(content, conversationId, workspaceId, files, gateClaim);
      if (gateClaim && run.runId !== gateClaim.acceptance_fence.run_id) {
        throw new Error("FALCON24_BROWSER_GATE_RUN_ID_MISMATCH");
      }
      if (gateClaim) {
        window.sessionStorage.setItem(
          FALCON24_GATE_CONSUMED_KEY,
          JSON.stringify({
            schema_version: "falcon24-e1-browser-submit-consumed@1.0.0",
            run_id: run.runId,
            attempt_id: gateClaim.acceptance_fence.attempt_id,
            conversation_id: conversationId,
          }),
        );
      }
      runAccepted = true;

      const agentMessageId = `local-agent-${Date.now()}`;
      const agentMessage: Message = {
        id: agentMessageId,
        conversationId,
        role: "agent",
        content: "",
        type: "text",
        runId: run.runId,
        createdAt: new Date().toISOString(),
      };
      set((current) => ({
        messages: [...current.messages, agentMessage],
        connection: "connecting",
        activeRunId: run.runId,
        inspectorTarget: null,
        inspectorTriggerId: null,
      }));
      replaceQAInspectorTargetInBrowser(null, conversationId);

      // sequence 是断线补发、去重和恢复的唯一游标。
      const session = createQaRunStream({
        onConnection: (connection) => set({ connection }),
        onEvent: (event) => {
          set((current) => {
            if (current.activeConversationId !== conversationId) return {};
            const events = mergePublicRunEvents(current.events, [event]);
            const streamedContent = answerText(events, run.runId);
            return {
              events,
              messages: replaceMessage(current.messages, agentMessageId, {
                content: streamedContent,
                type: "text",
              }),
            };
          });
        },
        run_id: run.runId,
        workspace_id: workspaceId,
      });
      activeStreamSession = session;
      const timeout = setTimeout(() => session.abort(), 10 * 60_000);
      let finalProjection: RunProjection | null = null;
      let streamResult: Awaited<ReturnType<QaRunStreamSession["run"]>>;
      try {
        streamResult = await session.run();
      } finally {
        clearTimeout(timeout);
        if (activeStreamSession === session) activeStreamSession = null;
      }

      finalProjection = await getRun(run.runId, workspaceId);
      if (
        !streamResult.terminal &&
        !["COMPLETED", "FAILED", "CANCELLED"].includes(finalProjection.status)
      ) {
        if (streamResult.error instanceof Error) throw streamResult.error;
        throw new Error("事件流连接超时，Run 仍在执行，可稍后从轨迹恢复");
      }
      const streamedAnswer = answerText(get().events, run.runId);
      const finalContent = streamedAnswer || terminalAnswer(finalProjection);
      const finalType: Message["type"] = finalProjection.reports?.length ? "report" : "text";
      set((current) => ({
        messages: replaceMessage(current.messages, agentMessageId, {
          content: finalContent,
          type: finalType,
          metadata: { event_sequence: streamResult.cursor },
        }),
        sending: false,
        connection: "closed",
        activeRunId: null,
      }));
      finalAnswerProjected = true;

      const persisted = await fetch(
        workspaceQaPath(`/conversations/${encodeURIComponent(conversationId)}/messages`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "workspace-conversation-message-append@1.0.0",
            message_id: run.runId,
            role: "agent",
            content: finalContent,
            type: finalType,
            run_id: run.runId,
            metadata: { event_sequence: streamResult.cursor },
          }),
        },
      );
      if (!persisted.ok) throw new Error("最终回答持久化失败");
      await get().loadTrajectory(conversationId);
      set((current) => ({
        conversations: current.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messageCount: conversation.messageCount + 2 }
            : conversation,
        ),
      }));
      return true;
    } catch (err) {
      const errorContent = err instanceof Error ? err.message : "分析请求失败";
      if (finalAnswerProjected) {
        set({
          sending: false,
          connection: "closed",
          activeRunId: null,
          error: `最终回答索引持久化失败；回答仍可从 Run 事件恢复。${errorContent}`,
        });
        return true;
      }
      set((current) => {
        const pending = [...current.messages]
          .reverse()
          .find((message) => message.role === "agent" && message.runId && !message.content);
        return {
          messages: (pending
            ? replaceMessage(current.messages, pending.id, { content: errorContent, type: "error" })
            : [
                ...current.messages,
                {
                  id: `local-err-${Date.now()}`,
                  conversationId,
                  role: "agent" as const,
                  content: errorContent,
                  type: "error" as const,
                  createdAt: new Date().toISOString(),
                },
              ]
          ).filter((message) => runAccepted || message.id !== userMessage.id),
          sending: false,
          connection: "closed",
          activeRunId: null,
          error: errorContent,
        };
      });
      return runAccepted;
    }
  },

  stopMessage: async () => {
    const runId = get().activeRunId;
    if (!runId) return;
    const workspaceId = resolveWorkspaceId();
    if (!workspaceId) return;
    set({ connection: "closed" });
    try {
      await commandRun(runId, "cancel", workspaceId);
      activeStreamSession?.abort();
      set({ sending: false, activeRunId: null, resourceNotice: "已请求停止当前分析" });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "停止分析失败" });
    }
  },

  loadDataSources: async () => {
    try {
      const dataSources = await fetchDataSources();
      set({ dataSources });
    } catch {
      // 静默失败，不影响主流程
    }
  },

  updateActiveConversationResources: async (input) => {
    const current = get();
    const conversationId = current.activeConversationId;
    const activeConversation = current.conversations.find(
      (conversation) => conversation.id === conversationId,
    );
    if (!conversationId || !activeConversation) {
      const created = await get().createConversation({
        title: "新业务问题",
        ...(input.dataSourceId ? { dataSourceId: input.dataSourceId } : {}),
        ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}),
      });
      if (!created) set({ resourceError: "创建新对话后才能选择资源" });
      return;
    }
    const dataSourceId =
      input.dataSourceId ??
      activeConversation.dataSourceId ??
      current.resourceCatalog?.datasources.find((source) => source.selectable)?.datasource_id;
    const modelProfileId =
      input.modelProfileId ??
      activeConversation.modelProfileId ??
      current.resourceCatalog?.models.find((model) => model.selectable)?.model_profile_id;
    if (!dataSourceId || !modelProfileId) {
      set({ resourceError: "必须同时选择可运行模型和可用数据源" });
      return;
    }
    if (
      dataSourceId === activeConversation.dataSourceId &&
      modelProfileId === activeConversation.modelProfileId
    ) {
      return;
    }

    set({ resourceSwitching: true, resourceError: undefined, resourceNotice: undefined });
    try {
      const response = await fetch(
        workspaceQaPath(`/conversations/${encodeURIComponent(conversationId)}/resources`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "qa-conversation-resource-switch@1.0.0",
            datasource_id: dataSourceId,
            model_profile_id: modelProfileId,
            expected_resource_version: activeConversation.resourceVersion,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        data?: unknown;
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(json?.error?.message ?? "更新对话资源失败");
      const result = qaConversationResourceSwitchResultSchema.parse(json?.data);
      const updated = conversationFromContract(result.conversation);
      set((state) => {
        if (result.kind === "CREATED_REPLACEMENT") {
          return {
            conversations: [updated, ...state.conversations],
            activeConversationId: updated.id,
            messages: [],
            events: [],
            trajectoryFocus: null,
            inspectorTarget: null,
            inspectorTriggerId: null,
            resourceSwitching: false,
            resourceNotice: "已为新资源创建独立对话，原对话与执行证据保持不变",
          };
        }
        return {
          conversations: state.conversations.map((conversation) =>
            conversation.id === updated.id ? updated : conversation,
          ),
          resourceSwitching: false,
          resourceNotice: "对话资源已更新",
        };
      });
    } catch (err) {
      set({
        resourceSwitching: false,
        resourceError: err instanceof Error ? err.message : "更新对话资源失败",
      });
    }
  },

  clearError: () => set({ error: undefined }),

  reset: () => {
    directoryRequestGeneration += 1;
    activeStreamSession?.abort();
    activeStreamSession = null;
    set(initialState);
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  },
}));

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useQAConversations = () => useQAStore((s) => s.conversations);
export const useQAFolders = () => useQAStore((s) => s.folders);
export const useQADirectoryView = () => useQAStore((s) => s.directoryView);
export const useQADirectoryQuery = () => useQAStore((s) => s.directoryQuery);
export const useQADirectoryNextCursor = () => useQAStore((s) => s.directoryNextCursor);
export const useQAUngroupedName = () => useQAStore((s) => s.ungroupedName);
export const useQAExpandedFolderIds = () => useQAStore((s) => s.expandedFolderIds);
export const useQAPendingDirectoryIds = () => useQAStore((s) => s.pendingDirectoryIds);
export const useQAActiveConversationId = () => useQAStore((s) => s.activeConversationId);
export const useQAMessages = () => useQAStore((s) => s.messages);
export const useQAEvents = () => useQAStore((s) => s.events);
export const useQAView = () => useQAStore((s) => s.view);
export const useQATrajectoryFocus = () => useQAStore((s) => s.trajectoryFocus);
export const useQAInspectorTarget = () => useQAStore((s) => s.inspectorTarget);
export const useQAInspectorWidth = () => useQAStore((s) => s.inspectorWidth);
export const useQAConnection = () => useQAStore((s) => s.connection);
export const useQADataSources = () => useQAStore((s) => s.dataSources);
export const useQAResourceCatalog = () => useQAStore((s) => s.resourceCatalog);
export const useQAResourceCatalogState = () => useQAStore((s) => s.resourceCatalogState);
export const useQAResourceSwitching = () => useQAStore((s) => s.resourceSwitching);
export const useQAResourceError = () => useQAStore((s) => s.resourceError);
export const useQAResourceNotice = () => useQAStore((s) => s.resourceNotice);
export const useQAActiveRunId = () => useQAStore((s) => s.activeRunId);
export const useQALoading = () => useQAStore((s) => s.loading);
export const useQASending = () => useQAStore((s) => s.sending);
export const useQAError = () => useQAStore((s) => s.error);
