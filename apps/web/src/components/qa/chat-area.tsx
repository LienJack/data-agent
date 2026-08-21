"use client";

import { useEffect, useRef } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useQAActiveConversationId,
  useQAConversations,
  useQAEvents,
  useQALoading,
  useQAMessages,
  useQASending,
  useQATrajectoryFocus,
} from "@/lib/qa-store";
import { ChatMessage } from "./chat-message";
import { LoadingIndicator } from "./loading-indicator";

/**
 * 对话区域 — 右侧消息展示区。
 *
 * 消息列表自动滚动到底部；资源选择与连接状态统一由 ChatInput Composer 展示。
 */
export function ChatArea() {
  const messages = useQAMessages();
  const sending = useQASending();
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
      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <LoadingIndicator />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <EmptyState title="开始提问" description="在下方输入框输入您的问题" />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[920px]">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                events={
                  msg.role === "agent" && msg.runId
                    ? events.filter((event) => event.run_id === msg.runId)
                    : []
                }
              />
            ))}
            {sending &&
              !messages.some((message) => message.role === "agent" && !message.content) && (
                <div className="mb-3 flex justify-start">
                  <div className="border-l-2 border-[var(--color-accent)] px-3 py-2">
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
