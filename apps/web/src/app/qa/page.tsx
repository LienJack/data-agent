"use client";

import { ChatArea } from "@/components/qa/chat-area";
import { ChatInput } from "@/components/qa/chat-input";

/**
 * Q&A 对话页面。
 *
 * 对话式交互页面：
 * 对话历史已统一进入全局 Workspace Sidebar；页面只保留主对话区域，
 * 避免出现两条并列侧栏。
 */
export default function QAPage() {
  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--color-bg-primary)]">
      <ChatArea />
      <ChatInput />
    </div>
  );
}
