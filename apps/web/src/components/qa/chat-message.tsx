"use client";

import type { PublicRunEvent } from "@data-agent/contracts";
import { Cpu } from "@phosphor-icons/react";
import { assembleConversationActivity, isRunTerminal } from "@/lib/qa-event-assembler";
import type { Message } from "@/lib/qa-types";
import { formatDateTime } from "@/lib/utils";
import { ConversationActivityStream } from "./conversation-activity-stream";
import { SafeAssistantMarkdown } from "./safe-assistant-markdown";

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
  const activity =
    message.role === "agent" && message.runId
      ? assembleConversationActivity(events, message.runId)
      : [];
  const hasAnswerEvents = activity.some((block) => block.kind === "text");
  const streaming = Boolean(
    message.runId && activity.length > 0 && !isRunTerminal(events, message.runId),
  );

  return (
    <div
      id={!isUser && message.runId ? `chat-run-${message.runId}` : undefined}
      className={`mb-8 flex ${isUser ? "justify-end" : "justify-start"} scroll-m-20`}
    >
      <div
        className={`${isUser ? "max-w-[84%] rounded-[var(--radius-item)] px-4 py-3" : "w-full"} ${
          isUser
            ? "bg-[#27304a] text-white shadow-[0_14px_28px_-22px_rgb(21_29_53_/_0.8)]"
            : message.type === "error"
              ? "border-l-2 border-[var(--color-error)] bg-red-50 px-4 py-3 text-red-800"
              : "text-[var(--color-text-primary)]"
        }`}
      >
        {!isUser && (
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-[9px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Cpu aria-hidden="true" size={15} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold">Data Agent</p>
              <p className="font-mono text-[9px] text-[var(--color-text-muted)]">
                governed response
              </p>
            </div>
          </div>
        )}
        {activity.length > 0 && message.runId && (
          <ConversationActivityStream
            blocks={activity}
            events={events}
            runId={message.runId}
            streaming={streaming}
          />
        )}
        {/* Legacy messages without answer events retain their persisted body. */}
        {!hasAnswerEvents && message.type === "report" ? (
          <ReportContent message={message} />
        ) : !hasAnswerEvents && message.type === "hypothesis" ? (
          <HypothesisContent message={message} />
        ) : !hasAnswerEvents && isUser ? (
          <div className="whitespace-pre-wrap text-sm">
            {message.content || (message.runId ? "正在生成回答…" : "")}
          </div>
        ) : !hasAnswerEvents ? (
          <article className="agent-answer" aria-label="Data Agent 回答">
            <SafeAssistantMarkdown
              content={message.content || (message.runId ? "正在生成回答…" : "")}
              runId={message.runId}
              streaming={streaming}
            />
          </article>
        ) : null}

        {/* 时间戳 */}
        <div
          className={`mt-2 font-mono text-[9px] ${
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
      <SafeAssistantMarkdown content={message.content} runId={message.runId} />
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
      <SafeAssistantMarkdown content={message.content} runId={message.runId} />
    </div>
  );
}
