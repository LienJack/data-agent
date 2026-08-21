"use client";

import type { WorkspaceFileReference } from "@data-agent/contracts";
import { PaperPlaneTilt, Pulse, Stop, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import {
  useQAActiveConversationId,
  useQAConnection,
  useQAConversations,
  useQAResourceCatalog,
  useQAResourceCatalogState,
  useQAResourceError,
  useQAResourceNotice,
  useQAResourceSwitching,
  useQASending,
  useQAStore,
} from "@/lib/qa-store";
import { cn } from "@/lib/utils";
import { DataSourceSelector } from "./data-source-selector";
import { FileAttachmentSelector } from "./file-attachment-selector";
import { ModelSelector } from "./model-selector";

export function ChatInput() {
  const sendMessage = useQAStore((state) => state.sendMessage);
  const stopMessage = useQAStore((state) => state.stopMessage);
  const sending = useQASending();
  const connection = useQAConnection();
  const switching = useQAResourceSwitching();
  const catalog = useQAResourceCatalog();
  const catalogState = useQAResourceCatalogState();
  const resourceError = useQAResourceError();
  const resourceNotice = useQAResourceNotice();
  const conversations = useQAConversations();
  const activeId = useQAActiveConversationId();
  const [input, setInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<readonly WorkspaceFileReference[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const hasCatalogDefaults = Boolean(
    catalog?.models.some((model) => model.selectable) &&
      catalog.datasources.some((datasource) => datasource.selectable),
  );
  const resourcesComplete = activeConversation
    ? Boolean(activeConversation.modelProfileId && activeConversation.dataSourceId)
    : hasCatalogDefaults;
  const unavailableReason =
    catalogState === "loading" || catalogState === "idle"
      ? "正在加载模型和数据源"
      : catalogState === "error"
        ? "资源目录加载失败"
        : !resourcesComplete
          ? "请先选择可运行模型和可用数据源"
          : !input.trim()
            ? "请输入问题"
            : switching
              ? "正在切换对话资源"
              : undefined;
  const sendDisabled = Boolean(unavailableReason);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending || switching || !resourcesComplete) return;
    const accepted = await sendMessage(trimmed, selectedFiles);
    if (accepted) {
      setInput("");
      setSelectedFiles([]);
    }
    inputRef.current?.focus();
  }, [input, resourcesComplete, selectedFiles, sendMessage, sending, switching]);

  return (
    <div className="shrink-0 border-t border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-bg-surface)_96%,transparent)] px-3 pb-3 pt-3 backdrop-blur-xl sm:px-5">
      <div className="mx-auto w-full max-w-[920px]">
        {(resourceError || resourceNotice) && (
          <div
            className={cn(
              "mb-2 flex items-center gap-2 px-2 text-xs",
              resourceError
                ? "text-[var(--color-status-danger)]"
                : "text-[var(--color-text-muted)]",
            )}
            role={resourceError ? "alert" : "status"}
            aria-live="polite"
          >
            {resourceError ? (
              <WarningCircle className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Pulse className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{resourceError ?? resourceNotice}</span>
          </div>
        )}

        <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2.5 pb-2.5 pt-3 shadow-[var(--shadow-float)] transition-[border-color,box-shadow] focus-within:border-[var(--color-border-focused)] sm:px-3 sm:pb-3">
          <label htmlFor="qa-composer-input" className="sr-only">
            给数据分析 Agent 发送消息
          </label>
          <textarea
            id="qa-composer-input"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !composingRef.current
              ) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="向数据分析 Agent 提问…"
            rows={3}
            disabled={sending}
            className="max-h-52 min-h-[72px] w-full resize-none border-0 bg-transparent px-2 py-1 text-[15px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[84px]"
          />

          <div className="mt-1 grid min-w-0 grid-cols-1 gap-2 border-t border-[var(--color-border-default)]/70 pt-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0 w-full sm:w-auto sm:flex-none">
              <DataSourceSelector />
            </div>
            <div className="flex min-w-0 w-full items-center justify-end gap-1.5 sm:w-auto sm:flex-none">
              {sending && (
                <span className="hidden items-center gap-1 text-[10px] text-[var(--color-text-muted)] md:flex">
                  <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
                  {connection === "reconnecting" ? "恢复连接" : "执行中"}
                </span>
              )}
              <div className="min-w-0 flex-1 sm:flex-none">
                <ModelSelector />
              </div>
              <FileAttachmentSelector
                sessionId={activeId}
                disabled={sending || switching}
                selected={selectedFiles}
                onChange={setSelectedFiles}
              />
              {sending ? (
                <button
                  type="button"
                  onClick={() => void stopMessage()}
                  aria-label="停止当前分析"
                  title="停止当前分析"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-bg-primary)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focused)]"
                >
                  <Stop className="size-4" weight="fill" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sendDisabled}
                  aria-label="发送消息"
                  title={unavailableReason ?? "发送消息"}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white transition-[transform,background-color,opacity] hover:scale-[1.03] hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focused)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:scale-100"
                >
                  <PaperPlaneTilt className="size-[18px]" weight="fill" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
