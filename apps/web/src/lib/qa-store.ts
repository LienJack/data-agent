"use client";

import type {
  PublicRunEvent,
  WorkspaceConversation,
  WorkspaceConversationMessage,
} from "@data-agent/contracts";
import { create } from "zustand";
import {
  createRun,
  fetchConversationTrajectory,
  getRun,
  resolveWorkspaceId,
  streamRunEvents,
  waitWithBackoff,
} from "./api-client";
import { fetchDataSources } from "./datasource-api";
import type { DataSourceConnection } from "./datasource-types";
import { answerText, mergePublicRunEvents } from "./qa-event-assembler";
import type {
  Conversation,
  CreateConversationInput,
  Message,
  QAView,
  TrajectoryFocus,
  UpdateConversationResourcesInput,
} from "./qa-types";
import type { RunConnectionState, RunProjection } from "./run-projection";

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
  /** 当前对话从持久化 Run 事件恢复出的同源过程与轨迹。 */
  events: PublicRunEvent[];
  view: QAView;
  trajectoryFocus: TrajectoryFocus | null;
  connection: RunConnectionState;
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
  loadTrajectory: (conversationId: string) => Promise<void>;
  setView: (view: QAView) => void;
  openTrajectory: (focus: TrajectoryFocus) => void;
  openConversation: (focus: TrajectoryFocus) => void;
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
  events: [],
  view: "conversation",
  trajectoryFocus: null,
  connection: "idle",
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
        events: [],
        view: "conversation",
        trajectoryFocus: null,
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
        const deletingActive = state.activeConversationId === id;
        const conversations = state.conversations.filter((c) => c.id !== id);
        const activeConversationId = deletingActive
          ? (conversations[0]?.id ?? null)
          : state.activeConversationId;
        return {
          conversations,
          activeConversationId,
          ...(deletingActive ? { messages: [], events: [], trajectoryFocus: null } : {}),
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除对话失败" });
    }
  },

  selectConversation: async (id) => {
    set({ activeConversationId: id, messages: [], events: [], trajectoryFocus: null });
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
        set({
          messages: json.data.map(messageFromContract),
          events: trajectory.events,
          loading: false,
        });
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
      }));

      // sequence 是断线补发、去重和恢复的唯一游标。
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
      let finalProjection: RunProjection | null = null;
      let cursor = 0;
      let terminal = false;
      let reconnectAttempt = 0;
      let streamError: unknown;
      try {
        while (!terminal && !controller.signal.aborted) {
          try {
            set({ connection: reconnectAttempt === 0 ? "connecting" : "reconnecting" });
            await streamRunEvents({
              runId: run.runId,
              workspaceId,
              cursor,
              signal: controller.signal,
              onEvent: (event) => {
                cursor = Math.max(cursor, event.sequence);
                terminal ||= event.type === "terminal";
                set((current) => {
                  const events = mergePublicRunEvents(current.events, [event]);
                  const content = answerText(events, run.runId);
                  return {
                    events,
                    connection: "live",
                    messages: replaceMessage(current.messages, agentMessageId, {
                      content,
                      type: "text",
                    }),
                  };
                });
              },
            });
            reconnectAttempt = terminal ? reconnectAttempt : reconnectAttempt + 1;
          } catch (error) {
            if (controller.signal.aborted) break;
            reconnectAttempt += 1;
            if (reconnectAttempt > 8) throw error;
          }
          if (!terminal) await waitWithBackoff(reconnectAttempt, controller.signal);
        }
      } catch (error) {
        streamError = error;
      } finally {
        clearTimeout(timeout);
      }

      finalProjection = await getRun(run.runId, workspaceId);
      if (!terminal && !["COMPLETED", "FAILED", "CANCELLED"].includes(finalProjection.status)) {
        if (streamError instanceof Error) throw streamError;
        throw new Error("事件流连接超时，Run 仍在执行，可稍后从轨迹恢复");
      }
      const streamedAnswer = answerText(get().events, run.runId);
      const finalContent = streamedAnswer || terminalAnswer(finalProjection);
      const finalType: Message["type"] = finalProjection.reports?.length ? "report" : "text";
      set((current) => ({
        messages: replaceMessage(current.messages, agentMessageId, {
          content: finalContent,
          type: finalType,
          metadata: { event_sequence: cursor },
        }),
        sending: false,
        connection: "closed",
      }));

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
            metadata: { event_sequence: cursor },
          }),
        },
      );
      if (!persisted.ok) throw new Error("最终回答持久化失败");
      await get().loadTrajectory(conversationId);
    } catch (err) {
      const errorContent = err instanceof Error ? err.message : "分析请求失败";
      set((current) => {
        const pending = [...current.messages]
          .reverse()
          .find((message) => message.role === "agent" && message.runId && !message.content);
        return {
          messages: pending
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
              ],
          sending: false,
          connection: "closed",
          error: errorContent,
        };
      });
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
export const useQAEvents = () => useQAStore((s) => s.events);
export const useQAView = () => useQAStore((s) => s.view);
export const useQATrajectoryFocus = () => useQAStore((s) => s.trajectoryFocus);
export const useQAConnection = () => useQAStore((s) => s.connection);
export const useQADataSources = () => useQAStore((s) => s.dataSources);
export const useQALoading = () => useQAStore((s) => s.loading);
export const useQASending = () => useQAStore((s) => s.sending);
export const useQAError = () => useQAStore((s) => s.error);
