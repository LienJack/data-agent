import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  /**
   * 骨架屏模式：
   * - "text": 单行文本占位（默认）
   * - "card": 卡片整体占位
   * - "circle": 圆形占位
   */
  variant?: "text" | "card" | "circle";
}

export function Skeleton({ className, variant = "text" }: SkeletonProps) {
  if (variant === "card") {
    return (
      <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4">
        <div className="space-y-3">
          <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
          <div className="h-2 w-full animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
          <div className="h-2 w-5/6 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "animate-pulse bg-[var(--color-bg-tertiary)]",
        variant === "circle" ? "rounded-full" : "rounded",
        className || "h-3 w-full",
      )}
    />
  );
}
