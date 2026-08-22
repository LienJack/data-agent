import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "success" | "warning" | "danger" | "outline";
}

const variantStyles: Record<string, string> = {
  default: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  secondary: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  outline: "border border-[var(--color-border-default)] text-[var(--color-text-secondary)]",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
