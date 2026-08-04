"use client";

import { useState } from "react";
import { useWorkbenchStore } from "@/lib/workbench-store";

export function ClarificationDialog() {
  const pending = useWorkbenchStore((s) => s.clarificationPending);
  const setClarificationPending = useWorkbenchStore((s) => s.setClarificationPending);
  const setClarification = useWorkbenchStore((s) => s.setClarification);

  const [text, setText] = useState("");

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="澄清问题"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-6 shadow-xl">
        <h3 className="text-lg font-semibold">需要澄清</h3>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          请补充更多上下文，以便更精确地理解分析需求：
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如：请关注华南区 2025 年 Q1 的数据，按客户等级分组对比"
          rows={4}
          className="mt-4 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
          aria-label="澄清内容"
        />

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
            onClick={() => {
              setClarificationPending(false);
              setText("");
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!text.trim()}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            onClick={() => {
              setClarification(text);
              setClarificationPending(false);
              setText("");
            }}
          >
            提交澄清
          </button>
        </div>
      </div>
    </div>
  );
}
