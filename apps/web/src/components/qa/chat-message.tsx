"use client";

import type { PublicRunEvent } from "@data-agent/contracts";
import { assembleProcessRows } from "@/lib/qa-event-assembler";
import type { Message } from "@/lib/qa-types";
import { formatDateTime } from "@/lib/utils";
import { ProcessDisclosure } from "./process-disclosure";

interface ChatMessageProps {
  message: Message;
  events?: PublicRunEvent[];
}

/**
 * 单条消息气泡。
 *
 * 用户消息右对齐，Agent 消息左对齐。
 * 支持不同类型消息的展示：text、error、report、hypothesis。
 */
export function ChatMessage({ message, events = [] }: ChatMessageProps) {
  const isUser = message.role === "user";
  const processRows = message.runId ? assembleProcessRows(events, message.runId) : [];

  return (
    <div
      id={message.runId ? `chat-run-${message.runId}` : undefined}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3 scroll-m-20`}
    >
      <div
        className={`${isUser ? "max-w-[80%]" : "w-full max-w-3xl"} rounded-lg px-3 py-2 ${
          isUser
            ? "bg-[var(--color-accent)] text-white"
            : message.type === "error"
              ? "bg-red-900/20 text-red-400"
              : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
        }`}
      >
        {processRows.length > 0 && (
          <fieldset className="mb-3 space-y-0.5">
            <legend className="sr-only">执行过程</legend>
            {processRows.map((row) => (
              <ProcessDisclosure key={row.id} row={row} />
            ))}
          </fieldset>
        )}
        {/* 消息内容 */}
        {message.type === "report" ? (
          <ReportContent message={message} />
        ) : message.type === "hypothesis" ? (
          <HypothesisContent message={message} />
        ) : (
          <div className="whitespace-pre-wrap text-sm">
            {message.content || (message.runId ? "正在生成回答…" : "")}
          </div>
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
