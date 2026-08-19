"use client";

import { useCallback, useRef, useState } from "react";
import type { RunProjection } from "@/lib/run-projection";

interface WorkbenchComposerProps {
  projection: RunProjection | null;
  busy: boolean;
  onSubmit: (question: string) => Promise<void>;
}

export function WorkbenchComposer({ projection, busy, onSubmit }: WorkbenchComposerProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    await onSubmit(question);
    inputRef.current?.focus();
  }, [busy, draft, onSubmit]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-white via-white to-transparent px-6 pb-5 pt-8 lg:px-10">
      <div className="mx-auto max-w-[940px] rounded-2xl border border-[var(--color-border-default)] bg-white p-3 shadow-[0_12px_35px_rgba(25,35,30,0.10)]">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder="输入业务问题，例如：本季度净收入下降由哪些因素贡献？"
          className="max-h-28 min-h-12 w-full resize-none px-1 py-1 text-sm leading-6 placeholder:text-[var(--color-text-muted)] focus:outline-none"
          aria-label="分析问题输入"
          disabled={busy}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-full text-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
            aria-label="添加上下文"
          >
            +
          </button>
          <ContextPill label={projection?.scope?.dataset ?? "待绑定数据集"} />
          <ContextPill label={projection?.scope?.dialect ?? "待识别 SQL 方言"} />
          <span className="ml-auto hidden text-[11px] text-[var(--color-text-muted)] sm:inline">
            生成 L2 分析候选
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !draft.trim()}
            className="flex size-9 items-center justify-center rounded-full bg-[#171a18] text-white hover:bg-black disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-muted)]"
            aria-label="开始分析"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              className="size-4"
            >
              <path d="M10 15V4M5.5 8.5 10 4l4.5 4.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function ContextPill({ label }: { label: string }) {
  return (
    <span className="flex max-w-[170px] items-center gap-1.5 truncate rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-2.5 py-1 text-[10px] text-[var(--color-text-secondary)]">
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-success)]" />
      <span className="truncate">{label}</span>
    </span>
  );
}
