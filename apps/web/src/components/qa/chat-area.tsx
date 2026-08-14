"use client";

import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useQAActiveConversationId,
  useQAConnection,
  useQAConversations,
  useQAEvents,
  useQALoading,
  useQAMessages,
  useQASending,
  useQATrajectoryFocus,
} from "@/lib/qa-store";
import { ChatMessage } from "./chat-message";
import { DataSourceSelector } from "./data-source-selector";
import { LoadingIndicator } from "./loading-indicator";
import { ModelSelector } from "./model-selector";

/**
 * 对话区域 — 右侧消息展示区。
 *
 * 顶部：数据源和模型选择器
 * 中间：消息列表（自动滚动到底部）
 * 底部：由 ChatInput 处理
 */
export function ChatArea() {
  const messages = useQAMessages();
  const sending = useQASending();
  const connection = useQAConnection();
  const events = useQAEvents();
  const loading = useQALoading();
  const conversations = useQAConversations();
  const activeId = useQAActiveConversationId();
  const focus = useQATrajectoryFocus();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages.at(-1);
  const scrollSignal = `${lastMessage?.id ?? "empty"}:${lastMessage?.content.length ?? 0}:${events.at(-1)?.sequence ?? 0}:${sending ? "sending" : "idle"}`;

  // 新消息时自动滚动到底部
  useEffect(() => {
    if (scrollSignal && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [scrollSignal]);

  useEffect(() => {
    if (!focus) return;
    document
      .getElementById(`chat-run-${focus.runId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const activeConversation = conversations.find((c) => c.id === activeId);

  // 无活跃对话时显示空状态
  if (!activeConversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="选择或创建对话"
          description="从左侧选择一个对话，或点击「新对话」开始提问"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 选择器栏 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">本次对话资源</p>
          <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">选择会保存到当前对话</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sending && (
            <span
              className="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-1 text-[10px] text-[var(--color-text-muted)]"
              aria-live="polite"
            >
              {connection === "reconnecting" ? "正在恢复事件流…" : "实时接收中"}
            </span>
          )}
          <DataSourceSelector />
          <ModelSelector />
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <LoadingIndicator />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <EmptyState title="开始提问" description="在下方输入框输入您的问题" />
          </div>
        ) : (
          <div>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                events={msg.runId ? events.filter((event) => event.run_id === msg.runId) : []}
              />
            ))}
            {sending &&
              !messages.some((message) => message.role === "agent" && !message.content) && (
                <div className="flex justify-start mb-3">
                  <div className="max-w-[80%] rounded-lg bg-[var(--color-bg-tertiary)] px-3 py-2">
                    <LoadingIndicator />
                  </div>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
