"use client";

import type { PublicRunEvent } from "@data-agent/contracts";
import { Cpu } from "@phosphor-icons/react";
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
      className={`mb-6 flex ${isUser ? "justify-end" : "justify-start"} scroll-m-20`}
    >
      <div
        className={`${isUser ? "max-w-[82%] rounded-lg px-3.5 py-2.5" : "w-full"} ${
          isUser
            ? "bg-[var(--color-text-primary)] text-white shadow-[var(--shadow-float)]"
            : message.type === "error"
              ? "border-l-2 border-[var(--color-error)] bg-red-50 px-4 py-3 text-red-800"
              : "text-[var(--color-text-primary)]"
        }`}
      >
        {!isUser && (
          <div className="mb-2.5 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-text-primary)] text-white">
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
        {processRows.length > 0 && (
          <fieldset className="agent-process-list">
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
          <div
            className={isUser ? "whitespace-pre-wrap text-sm" : "agent-answer whitespace-pre-wrap"}
          >
            {message.content || (message.runId ? "正在生成回答…" : "")}
          </div>
        )}

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
