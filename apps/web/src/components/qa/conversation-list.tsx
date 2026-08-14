"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useQAActiveConversationId, useQAConversations, useQAStore } from "@/lib/qa-store";
import { relativeTime } from "@/lib/utils";

/**
 * 对话历史列表。
 *
 * 左侧面板，展示所有历史对话记录。
 * 支持创建新对话、切换对话和删除对话。
 */
export function ConversationList() {
  const loadConversations = useQAStore((s) => s.loadConversations);
  const createConversation = useQAStore((s) => s.createConversation);
  const deleteConversation = useQAStore((s) => s.deleteConversation);
  const selectConversation = useQAStore((s) => s.selectConversation);
  const conversations = useQAConversations();
  const activeId = useQAActiveConversationId();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleNew = async () => {
    await createConversation({ title: "新对话" });
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="shrink-0 border-b border-[var(--color-border-default)] px-3 py-2">
        <Button variant="primary" size="sm" className="w-full" onClick={handleNew}>
          新对话
        </Button>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="px-3 py-6">
            <EmptyState title="暂无对话" description="点击「新对话」开始提问" />
          </div>
        ) : (
          <div className="space-y-0.5 px-2 py-2">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  conv.id === activeId
                    ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  onClick={() => selectConversation(conv.id)}
                  aria-current={conv.id === activeId ? "page" : undefined}
                >
                  <div className="truncate text-xs font-medium">{conv.title}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {relativeTime(conv.updatedAt)}
                  </div>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-red-900/30 group-hover:opacity-100"
                  onClick={() => deleteConversation(conv.id)}
                  aria-label={`删除对话：${conv.title}`}
                  title="删除对话"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-3 w-3"
                  >
                    <path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5Zm2.5.5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6Zm1.5-.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5Z" />
                    <path d="M2 4a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1v6a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7h1a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H2Zm10 1v1H3V5h9ZM5 7h1v6H5V7Zm2 0h1v6H7V7Zm2 0h1v6H9V7Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
