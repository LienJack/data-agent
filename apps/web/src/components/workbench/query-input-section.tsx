"use client";

import { useCallback, useEffect, useRef } from "react";
import { isRunTerminal } from "@/lib/run-projection";
import { useWorkbenchStore } from "@/lib/workbench-store";

export function QueryInputSection({
  onSubmit,
  onCommand,
  submissionDisabled = false,
}: {
  onSubmit?: (question: string) => Promise<void>;
  onCommand?: (command: "cancel" | "resume" | "replay") => Promise<void>;
  submissionDisabled?: boolean;
}) {
  const projection = useWorkbenchStore((s) => s.projection);
  const sectionStatus = useWorkbenchStore((s) => s.sections.query);
  const currentAction = useWorkbenchStore((s) => s.currentAction);
  const l2Only = useWorkbenchStore((s) => s.projection?.l2Only ?? true);
  const l3Route = useWorkbenchStore((s) => s.l3Route);
  const l4Route = useWorkbenchStore((s) => s.l4Route);
  const l5Route = useWorkbenchStore((s) => s.l5Route);
  const connection = useWorkbenchStore((s) => s.connection);
  const activeRunId = useWorkbenchStore((s) => s.activeRunId);
  const busy = useWorkbenchStore((s) => s.busy);

  const setQuestion = useWorkbenchStore((s) => s.setQuestion);
  const setSectionStatus = useWorkbenchStore((s) => s.setSectionStatus);
  const setCurrentAction = useWorkbenchStore((s) => s.setCurrentAction);
  const setClarificationPending = useWorkbenchStore((s) => s.setClarificationPending);

  const question = projection?.question ?? "";
  const runStatus = projection?.status;

  const inputRef = useRef<HTMLInputElement>(null);
  const previousAction = useRef(currentAction);
  const actionRef = useRef<HTMLDivElement>(null);

  /** 当前 Run 是否活跃（非终态） */
  const isActive = !!runStatus && !isRunTerminal(runStatus);

  // 当前动作变化时通知读屏软件
  useEffect(() => {
    if (previousAction.current !== currentAction && actionRef.current) {
      actionRef.current.textContent = `当前动作: ${currentAction}`;
    }
    previousAction.current = currentAction;
  }, [currentAction]);

  // 组件挂载时自动聚焦输入框
  useEffect(() => {
    if (sectionStatus === "ready" && !isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [sectionStatus, isActive]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        question.trim() &&
        !busy &&
        !isActive &&
        !submissionDisabled
      ) {
        e.preventDefault();
        if (onSubmit) {
          void onSubmit(question.trim());
        }
      }
    },
    [question, busy, isActive, onSubmit, submissionDisabled],
  );

  if (sectionStatus === "loading") {
    return (
      <div className="card">
        <h2 className="section-header">分析查询</h2>
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-12"
          role="alert"
        >
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
            正在加载工作空间…
          </div>
        </div>
      </div>
    );
  }

  if (sectionStatus === "error") {
    return (
      <div className="card">
        <h2 className="section-header">分析查询</h2>
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-red-200 bg-red-50 py-12 dark:border-red-800 dark:bg-red-900/20"
          role="alert"
        >
          <div className="text-center">
            <p className="text-sm text-red-700 dark:text-red-400">加载失败，请重试</p>
            <button
              type="button"
              onClick={() => {
                setSectionStatus("query", "loading");
                setCurrentAction("重新连接…");
              }}
              className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sectionStatus === "permission_denied") {
    return (
      <div className="card">
        <h2 className="section-header">分析查询</h2>
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-12"
          role="alert"
        >
          <p className="text-sm text-[var(--color-text-tertiary)]">
            权限不足 · 需要 ANALYST 或更高角色
          </p>
        </div>
      </div>
    );
  }

  if (sectionStatus === "stale") {
    return (
      <div className="card">
        <h2 className="section-header">分析查询</h2>
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-amber-200 bg-amber-50 py-12 dark:border-amber-800 dark:bg-amber-900/20"
          role="alert"
        >
          <p className="text-sm text-amber-700 dark:text-amber-400">数据已过期 · 需要重新查询</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="section-header">分析查询</h2>

      {/* 读屏软件 — 当前动作播报 */}
      <div
        ref={actionRef}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />

      {/* 连接状态指示器 */}
      {activeRunId && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]"
          aria-live="polite"
        >
          <span
            className={`inline-block size-2 rounded-full ${
              connection === "live"
                ? "bg-emerald-500"
                : connection === "closed"
                  ? "bg-stone-400"
                  : "bg-amber-500"
            }`}
          />
          {connection === "live"
            ? "实时同步"
            : connection === "closed"
              ? "事件流已封存"
              : connection === "connecting"
                ? "正在连接"
                : "正在重连"}
          {busy && (
            <span className="ml-1 inline-block size-3 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
          )}
        </div>
      )}

      <div className="flex gap-3">
        <input
          type="text"
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入分析问题，例如：2025 年第一季度华南区净收入同比为什么下降？"
          className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-2.5 text-sm placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
          aria-label="分析问题输入"
          aria-describedby="query-input-hint"
          disabled={isActive || submissionDisabled}
        />
        <span id="query-input-hint" className="sr-only">
          输入分析问题后按 Enter 提交，或点击分析按钮
        </span>
        <button
          type="button"
          disabled={!question.trim() || busy || isActive || submissionDisabled}
          onClick={() => {
            if (onSubmit && question.trim()) {
              void onSubmit(question.trim());
            }
          }}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          aria-label="开始分析"
        >
          分析
        </button>
        <button
          type="button"
          disabled={!question.trim() || busy || isActive}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
          aria-label="请求澄清"
          onClick={() => setClarificationPending(true)}
        >
          澄清
        </button>
      </div>

      {/* 取消/恢复/重播按钮 — 仅在活跃 Run 时显示 */}
      {activeRunId && (
        <fieldset className="mt-3 flex flex-wrap items-center gap-2 border-0 p-0">
          <legend className="sr-only">运行控制</legend>
          {isActive && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (onCommand) void onCommand("cancel");
              }}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
              aria-label="取消分析"
            >
              取消
            </button>
          )}
          {!isActive && runStatus && isRunTerminal(runStatus) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (onCommand) void onCommand("replay");
              }}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
              aria-label="重新分析"
            >
              重播
            </button>
          )}
          {/* 运行状态标签 */}
          <span
            className="ml-auto text-xs font-medium text-[var(--color-text-tertiary)]"
            aria-live="polite"
          >
            {runStatus === "QUEUED" && "排队中"}
            {runStatus === "RUNNING" && "运行中"}
            {runStatus === "COMPLETED" && "已完成"}
            {runStatus === "FAILED" && "失败"}
            {runStatus === "CANCELLED" && "已取消"}
          </span>
        </fieldset>
      )}

      {projection?.scope && (
        <section
          className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--color-text-tertiary)]"
          aria-label="工作空间上下文"
        >
          <span>
            工作空间:{" "}
            <code className="rounded bg-[var(--color-bg-secondary)] px-1 py-0.5 font-mono">
              {projection.scope.workspace ?? "—"}
            </code>
          </span>
          <span>
            数据集:{" "}
            <code className="rounded bg-[var(--color-bg-secondary)] px-1 py-0.5 font-mono">
              {projection.scope.dataset ?? "—"}
            </code>
          </span>
          <span>
            方言:{" "}
            <code className="rounded bg-[var(--color-bg-secondary)] px-1 py-0.5 font-mono">
              {projection.scope.dialect ?? "—"}
            </code>
          </span>
        </section>
      )}

      <section className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="能力标签">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          L2 多步研究分析师
        </span>
        {l3Route === "NOT_DELIVERED" && (
          <span className="rounded-full bg-gray-50 px-2 py-0.5 text-gray-400 line-through dark:bg-gray-800 dark:text-gray-500">
            L3 实验 DAG
          </span>
        )}
        {l4Route === "NOT_DELIVERED" && (
          <span className="rounded-full bg-gray-50 px-2 py-0.5 text-gray-400 line-through dark:bg-gray-800 dark:text-gray-500">
            L4 主动发现
          </span>
        )}
        {l5Route === "NOT_DELIVERED" && (
          <span className="rounded-full bg-gray-50 px-2 py-0.5 text-gray-400 line-through dark:bg-gray-800 dark:text-gray-500">
            L5 因果决策
          </span>
        )}
      </section>

      <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
        {projection?.demoLicense ?? "Demo v1.0.0"} · 仅体验用途
        {l2Only && " · 仅 L2 能力"}
      </p>
    </div>
  );
}
