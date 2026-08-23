import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "default" | "lg";
  className?: string;
}

const sizeStyles = {
  sm: "size-4",
  default: "size-6",
  lg: "size-8",
};

export function Spinner({ size = "default", className }: SpinnerProps) {
  return (
    <svg
      className={cn("animate-spin text-[var(--color-text-tertiary)]", sizeStyles[size], className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label="加载中"
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

export function FullPageSpinner({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Spinner size="lg" />
      <p className="text-sm text-[var(--color-text-secondary)]">{label}</p>
    </div>
  );
}
