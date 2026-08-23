import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const variantClasses: Record<string, string> = {
  primary:
    "border border-transparent bg-[var(--color-accent)] text-white shadow-[0_8px_18px_-12px_rgb(38_71_168_/_0.72)] hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-pressed)]",
  secondary:
    "border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.82)] hover:border-[var(--color-border-overlay)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]",
  ghost:
    "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]",
  danger: "border border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100",
};

const sizeClasses: Record<string, string> = {
  sm: "min-h-8 px-2.5 py-1 text-xs",
  md: "min-h-9 px-3.5 py-1.5 text-sm",
  lg: "min-h-11 px-[18px] py-2 text-sm",
};

export function Button({
  className,
  variant = "primary",
  size = "sm",
  loading,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "control-pressable inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-45",
        variantClasses[variant],
        sizeClasses[size],
        loading && "cursor-wait",
        className,
      )}
      disabled={props.disabled || loading}
      {...props}
    />
  );
}
