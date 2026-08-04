import type { ReactNode } from "react";

export interface WorkbenchSectionProps {
  title: string;
  children: ReactNode;
  status?: "loading" | "empty" | "error" | "partial" | "stale" | "permission_denied" | "ready";
  className?: string;
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

export function WorkbenchSection({
  title,
  children,
  status = "ready",
  className = "",
}: WorkbenchSectionProps) {
  return (
    <section className={`card ${className}`}>
      <h2 className="section-header">{title}</h2>
      {status !== "ready" ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-12">
          <span className="text-sm text-[var(--color-text-tertiary)]">
            {statusMessages[status]}
          </span>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
