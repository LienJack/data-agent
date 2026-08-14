"use client";

import { useCallback, useRef, useState } from "react";
import { useQASending, useQAStore } from "@/lib/qa-store";

/**
 * 聊天输入框。
 *
 * 底部固定输入框，支持回车发送。
 * 发送中禁用输入。
 */
export function ChatInput() {
  const sendMessage = useQAStore((s) => s.sendMessage);
  const sending = useQASending();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setInput("");
    await sendMessage(trimmed);

    // 重新聚焦输入框
    inputRef.current?.focus();
  }, [input, sending, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="shrink-0 border-t border-[var(--color-border-default)] px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入您的问题... (Shift+Enter 换行)"
          rows={2}
          disabled={sending}
          className="min-h-[40px] flex-1 resize-none rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !input.trim()}
          aria-label="发送消息"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)] text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M3.5 3.5a.5.5 0 0 0-.5.5v4.5a.5.5 0 0 0 .5.5h5.5a.5.5 0 0 1 0 1H3.5a.5.5 0 0 0-.5.5V15a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5H3.5Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
