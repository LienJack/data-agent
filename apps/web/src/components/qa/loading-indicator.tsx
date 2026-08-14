"use client";

/**
 * 加载指示器。
 *
 * 三点脉冲动画，表示 Agent 正在处理。
 */
export function LoadingIndicator() {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-[var(--color-text-muted)]">思考中</span>
      <span className="flex gap-0.5">
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)]"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)]"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-accent)]"
          style={{ animationDelay: "300ms" }}
        />
      </span>
    </div>
  );
}
