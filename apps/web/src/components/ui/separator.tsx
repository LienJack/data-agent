import { cn } from "@/lib/utils";

interface SeparatorProps {
  className?: string;
  orientation?: "horizontal" | "vertical";
}

export function Separator({ className, orientation = "horizontal" }: SeparatorProps) {
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-[var(--color-border-default)]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}
