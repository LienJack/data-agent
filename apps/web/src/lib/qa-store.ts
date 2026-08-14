"use client";

import type { WorkspaceConversation, WorkspaceConversationMessage } from "@data-agent/contracts";
import { create } from "zustand";
import { createRun, getRun, resolveWorkspaceId, streamRunEvents } from "./api-client";
import { fetchDataSources } from "./datasource-api";
import type { DataSourceConnection } from "./datasource-types";
import type {
  Conversation,
  CreateConversationInput,
  Message,
  UpdateConversationResourcesInput,
} from "./qa-types";
import type { RunProjection } from "./run-projection";

/**
 * Q&A 状态管理。
 *
 * 管理对话列表、消息、数据源和模型选择状态。
 */

interface QAState {
  /** 对话列表 */
  conversations: Conversation[];
  /** 当前选中的对话 ID */
  activeConversationId: string | null;
  /** 当前对话的消息列表 */
  messages: Message[];
  /** 可用数据源列表 */
  dataSources: DataSourceConnection[];
  /** 加载状态 */
  loading: boolean;
  /** 消息发送中 */
  sending: boolean;
  /** 错误信息 */
  error: string | undefined;
}

interface QAActions {
  /** 加载对话列表 */
  loadConversations: () => Promise<void>;
  /** 创建新对话 */
  createConversation: (input: CreateConversationInput) => Promise<Conversation | null>;
  /** 删除对话 */
  deleteConversation: (id: string) => Promise<void>;
  /** 选中对话 */
  selectConversation: (id: string) => Promise<void>;
  /** 加载消息 */
  loadMessages: (conversationId: string) => Promise<void>;
  /** 发送消息 */
  sendMessage: (content: string) => Promise<void>;
  /** 加载数据源列表 */
  loadDataSources: () => Promise<void>;
  /** 更新当前对话的数据源或模型绑定 */
  updateActiveConversationResources: (input: UpdateConversationResourcesInput) => Promise<void>;
  /** 清除错误 */
  clearError: () => void;
  /** 获取当前对话 */
  getActiveConversation: () => Conversation | null;
}

export type QAStore = QAState & QAActions;

const initialState: QAState = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  dataSources: [],
  loading: false,
  sending: false,
  error: undefined,
};

function workspaceQaPath(path = ""): string {
  const workspaceId = resolveWorkspaceId();
  if (!workspaceId) throw new Error("请先选择工作空间");
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/qa${path}`;
}

function conversationFromContract(value: WorkspaceConversation): Conversation {
  return {
    id: value.conversation_id,
    title: value.title,
    dataSourceId: value.datasource_id ?? undefined,
    modelId: value.model_id ?? undefined,
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

export const useQAStore = create<QAStore>((set, get) => ({
  ...initialState,

  loadConversations: async () => {
    set({ loading: true, error: undefined });
    try {
      const response = await fetch(workspaceQaPath("/conversations"));
      if (!response.ok) throw new Error("加载对话列表失败");
      const json = (await response.json()) as { data: WorkspaceConversation[] };
      set({ conversations: json.data.map(conversationFromContract), loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载对话列表失败", loading: false });
    }
  },

  createConversation: async (input) => {
    set({ error: undefined });
    try {
      const response = await fetch(workspaceQaPath("/conversations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema_version: "workspace-conversation-create@1.0.0",
          title: input.title,
          datasource_id: input.dataSourceId ?? null,
          model_id: input.modelId ?? null,
        }),
      });
      if (!response.ok) throw new Error("创建对话失败");
      const json = (await response.json()) as { data: WorkspaceConversation };
      const conversation = conversationFromContract(json.data);
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: conversation.id,
        messages: [],
      }));
      return conversation;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "创建对话失败" });
      return null;
    }
  },

  deleteConversation: async (id) => {
    set({ error: undefined });
    try {
      const response = await fetch(workspaceQaPath(`/conversations/${encodeURIComponent(id)}`), {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("删除对话失败");
      set((state) => {
        const conversations = state.conversations.filter((c) => c.id !== id);
        const activeConversationId =
          state.activeConversationId === id
            ? (conversations[0]?.id ?? null)
            : state.activeConversationId;
        return { conversations, activeConversationId };
      });
      // 如果删除了当前对话，清空消息
      if (get().activeConversationId === id) {
        set({ messages: [] });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除对话失败" });
    }
  },

  selectConversation: async (id) => {
    set({ activeConversationId: id, messages: [] });
    await get().loadMessages(id);
  },

  loadMessages: async (conversationId) => {
    set({ loading: true, error: undefined });
    try {
      const response = await fetch(
        workspaceQaPath(`/conversations/${encodeURIComponent(conversationId)}/messages`),
      );
      if (!response.ok) throw new Error("加载消息失败");
      const json = (await response.json()) as { data: WorkspaceConversationMessage[] };
      set({ messages: json.data.map(messageFromContract), loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载消息失败", loading: false });
    }
  },

  sendMessage: async (content) => {
    const state = get();
    let conversationId = state.activeConversationId;

    // 如果没有活跃对话，自动创建一个
    if (!conversationId) {
      const defaultDatasource = state.dataSources.find((source) => source.status === "active");
      if (!defaultDatasource) {
        set({ error: "发送消息前请先创建并选择一个可用数据源" });
        return;
      }
      const conv = await get().createConversation({
        title: content.slice(0, 50) + (content.length > 50 ? "..." : ""),
        dataSourceId: defaultDatasource.id,
      });
      if (!conv) return;
      conversationId = conv.id;
    }

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

    try {
      const workspaceId = resolveWorkspaceId();
      const activeConversation = get().conversations.find((item) => item.id === conversationId);
      if (!workspaceId) throw new Error("请先选择工作空间");
      if (!activeConversation?.dataSourceId) throw new Error("发送消息前请先选择数据源");

      await fetch(
        workspaceQaPath(`/conversations/${encodeURIComponent(conversationId)}/messages`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "workspace-conversation-message-append@1.0.0",
            role: "user",
            content,
            type: "text",
            run_id: null,
            metadata: {},
          }),
        },
      ).then((response) => {
        if (!response.ok) throw new Error("用户消息持久化失败");
      });

      // 调用现有分析能力，并显式携带不可变的数据源/对话归因。
      const run = await createRun(
        content,
        workspaceId,
        activeConversation.dataSourceId,
        conversationId,
      );

      // 等待 Run 完成（简化版 — 从事件流获取结果）
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      let finalProjection: RunProjection | null = null;

      try {
        await streamRunEvents({
          runId: run.runId,
          workspaceId,
          cursor: 0,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "projection" || event.type === "terminal") {
              finalProjection = event.payload as RunProjection;
            }
          },
        });
      } catch {
        // 流可能被终止，尝试获取最终结果
        finalProjection = await getRun(run.runId, workspaceId);
      } finally {
        clearTimeout(timeout);
      }

      // 构建 Agent 消息
      const agentMessage: Message = {
        id: `local-agent-${Date.now()}`,
        conversationId,
        role: "agent",
        content: finalProjection?.question ?? "分析完成",
        type: finalProjection?.reports?.length ? "report" : "text",
        runId: run.runId,
        metadata: finalProjection ? { projection: finalProjection } : undefined,
        createdAt: new Date().toISOString(),
      };

      set((s) => ({ messages: [...s.messages, agentMessage], sending: false }));

      await fetch(
        workspaceQaPath(`/conversations/${encodeURIComponent(conversationId)}/messages`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "workspace-conversation-message-append@1.0.0",
            role: "agent",
            content: agentMessage.content,
            type: agentMessage.type,
            run_id: agentMessage.runId,
            metadata: agentMessage.metadata,
          }),
        },
      );
    } catch (err) {
      const errorMessage: Message = {
        id: `local-err-${Date.now()}`,
        conversationId,
        role: "agent",
        content: err instanceof Error ? err.message : "分析请求失败",
        type: "error",
        createdAt: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, errorMessage], sending: false }));
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
    const conversationId = get().activeConversationId;
    if (!conversationId) return;

    set({ error: undefined });
    try {
      const response = await fetch(
        workspaceQaPath(`/conversations/${encodeURIComponent(conversationId)}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "workspace-conversation-patch@1.0.0",
            ...(input.dataSourceId ? { datasource_id: input.dataSourceId } : {}),
            ...(input.modelId !== undefined ? { model_id: input.modelId || null } : {}),
          }),
        },
      );
      if (!response.ok) throw new Error("更新对话资源失败");
      const json = (await response.json()) as { data: WorkspaceConversation };
      const updated = conversationFromContract(json.data);
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "更新对话资源失败" });
    }
  },

  clearError: () => set({ error: undefined }),

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  },
}));

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useQAConversations = () => useQAStore((s) => s.conversations);
export const useQAActiveConversationId = () => useQAStore((s) => s.activeConversationId);
export const useQAMessages = () => useQAStore((s) => s.messages);
export const useQADataSources = () => useQAStore((s) => s.dataSources);
export const useQALoading = () => useQAStore((s) => s.loading);
export const useQASending = () => useQAStore((s) => s.sending);
export const useQAError = () => useQAStore((s) => s.error);
