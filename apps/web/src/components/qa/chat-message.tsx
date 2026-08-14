"use client";

import type { Message } from "@/lib/qa-types";
import { formatDateTime } from "@/lib/utils";

interface ChatMessageProps {
  message: Message;
}

/**
 * 单条消息气泡。
 *
 * 用户消息右对齐，Agent 消息左对齐。
 * 支持不同类型消息的展示：text、error、report、hypothesis。
 */
export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isUser
            ? "bg-[var(--color-accent)] text-white"
            : message.type === "error"
              ? "bg-red-900/20 text-red-400"
              : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
        }`}
      >
        {/* 消息内容 */}
        {message.type === "report" ? (
          <ReportContent message={message} />
        ) : message.type === "hypothesis" ? (
          <HypothesisContent message={message} />
        ) : (
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        )}

        {/* 时间戳 */}
        <div
          className={`mt-1 text-[10px] ${
            isUser ? "text-white/60" : "text-[var(--color-text-muted)]"
          }`}
        >
          {formatDateTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

/** 报告内容 */
function ReportContent({ message }: { message: Message }) {
  return (
    <div className="text-sm">
      <div className="mb-2 font-medium text-[var(--color-accent)]">分析报告</div>
      <div className="whitespace-pre-wrap text-[var(--color-text-primary)]">{message.content}</div>
      {message.runId && (
        <div className="mt-2 text-[10px] text-[var(--color-text-muted)]">
          Run ID: {message.runId}
        </div>
      )}
    </div>
  );
}

/** 假设内容 */
function HypothesisContent({ message }: { message: Message }) {
  return (
    <div className="text-sm">
      <div className="mb-2 font-medium text-[var(--color-accent)]">分析假设</div>
      <div className="whitespace-pre-wrap text-[var(--color-text-primary)]">{message.content}</div>
    </div>
  );
}
