import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "ghost" | "destructive" | "link";
type ButtonSize = "xs" | "sm" | "default" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  default: "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] shadow-sm",
  outline:
    "border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]",
  ghost:
    "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]",
  destructive:
    "bg-[var(--color-error)]/10 text-[var(--color-error)] hover:bg-[var(--color-error)]/20",
  link: "text-[var(--color-accent)] underline-offset-4 hover:underline",
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: "h-6 gap-1 rounded px-2 text-xs",
  sm: "h-7 gap-1 rounded-md px-2.5 text-sm",
  default: "h-8 gap-1.5 rounded-lg px-3 text-sm",
  lg: "h-9 gap-1.5 rounded-lg px-4 text-sm",
  icon: "size-8 rounded-lg",
};

export function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50 disabled:pointer-events-none disabled:opacity-50",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <SpinnerInline />}
      {children}
    </button>
  );
}

function SpinnerInline() {
  return (
    <svg
      aria-label="u52a0u8f7du4e2d"
      className="size-3.5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
