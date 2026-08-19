import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "success" | "warning" | "danger" | "outline";
}

const variantStyles: Record<string, string> = {
  default: "bg-[var(--color-accent)]/20 text-[var(--color-accent)]",
  secondary: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]",
  success: "bg-emerald-900/30 text-[#88C980]",
  warning: "bg-yellow-900/30 text-[#D8B76A]",
  danger: "bg-red-900/30 text-[#F87171]",
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
