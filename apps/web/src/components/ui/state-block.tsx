import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

/**
 * ViewState 渲染组件。
 * 符合 .trellis/spec/frontend/type-safety.md 的判别联合约定。
 */

export type ViewState =
  | { kind: "loading" }
  | { kind: "empty"; title?: string; description?: string; action?: ReactNode }
  | { kind: "error"; message: string; onRetry?: () => void }
  | { kind: "permission-denied" }
  | { kind: "success"; children: ReactNode };

interface StateBlockProps {
  state: ViewState;
  className?: string;
}

export function StateBlock({ state, className }: StateBlockProps) {
  switch (state.kind) {
    case "loading":
      return (
        <div
          className={cn(
            "surface-reading min-h-[200px] space-y-4 rounded-[var(--radius-panel)] border p-5",
            className,
          )}
          aria-busy="true"
          aria-label="正在加载"
          role="status"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="grid gap-3 pt-3 sm:grid-cols-2">
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </div>
        </div>
      );

    case "empty":
      return (
        <EmptyState
          className={className}
          title={state.title ?? "暂无数据"}
          description={state.description}
          action={state.action}
        />
      );

    case "error":
      return (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-item)] border border-[var(--color-error)]/20 bg-[color-mix(in_srgb,var(--color-error)_6%,white)] p-6 text-center",
            className,
          )}
        >
          <p className="text-sm font-medium text-[var(--color-error)]">{state.message}</p>
          {state.onRetry && (
            <button
              type="button"
              onClick={state.onRetry}
              className="control-pressable rounded-[var(--radius-control)] bg-[var(--color-error)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              重试
            </button>
          )}
        </div>
      );

    case "permission-denied":
      return (
        <EmptyState
          className={className}
          title="无访问权限"
          description="您没有查看此内容的权限。如需访问，请联系管理员。"
        />
      );

    case "success":
      return <>{state.children}</>;
  }
}
