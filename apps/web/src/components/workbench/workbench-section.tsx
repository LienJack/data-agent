import { type ReactNode, useEffect, useRef } from "react";

export interface WorkbenchSectionProps {
  title: string;
  children: ReactNode;
  status?: "loading" | "empty" | "error" | "partial" | "stale" | "permission_denied" | "ready";
  className?: string;
  /** 是否在状态变化时通知读屏软件 */
  announceStatus?: boolean;
}

const statusMessages: Record<string, string> = {
  loading: "加载中…",
  empty: "暂无数据",
  error: "加载失败",
  partial: "部分数据可用",
  stale: "数据已过期",
  permission_denied: "权限不足",
  ready: "",
};

const statusIcons: Record<string, string> = {
  loading: "⏳",
  empty: "📭",
  error: "❌",
  partial: "⚠️",
  stale: "🕐",
  permission_denied: "🔒",
  ready: "",
};

export function WorkbenchSection({
  title,
  children,
  status = "ready",
  className = "",
  announceStatus = true,
}: WorkbenchSectionProps) {
  const liveRef = useRef<HTMLDivElement>(null);
  const prevStatus = useRef(status);

  // 状态变化时通知读屏软件
  useEffect(() => {
    if (announceStatus && prevStatus.current !== status && status !== "ready") {
      if (liveRef.current) {
        liveRef.current.textContent = `${title}: ${statusMessages[status]}`;
      }
    }
    prevStatus.current = status;
  }, [status, title, announceStatus]);

  return (
    <section
      className={`card ${className}`}
      aria-label={title}
      aria-busy={status === "loading" ? true : undefined}
    >
      <h2 className="section-header">{title}</h2>

      {/* 用于读屏软件的状态播报（不可见） */}
      <div ref={liveRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />

      {status !== "ready" ? (
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-12"
          role="alert"
        >
          <span className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]">
            {status === "loading" && (
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
            )}
            {statusIcons[status] && <span aria-hidden="true">{statusIcons[status]}</span>}
            <span>{statusMessages[status]}</span>
          </span>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
