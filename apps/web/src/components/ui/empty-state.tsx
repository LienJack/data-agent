import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "surface-reading flex flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-2 grid size-10 place-items-center rounded-[var(--radius-control)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">
        {title}
      </h3>
      {description && (
        <p className="max-w-sm text-xs leading-5 text-[var(--color-text-tertiary)]">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
