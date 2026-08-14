import type { DatabaseType } from "@/lib/datasource-types";
import { cn } from "@/lib/utils";

interface DataSourceMarkProps {
  type: DatabaseType;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const MARKS: Record<DatabaseType, { text: string; background: string; foreground: string }> = {
  postgresql: { text: "PG", background: "#e8f0fb", foreground: "#336791" },
  mysql: { text: "MY", background: "#e9f4f6", foreground: "#176b78" },
  clickhouse: { text: "CH", background: "#fff7d7", foreground: "#826b00" },
  sqlite: { text: "SQ", background: "#e7f3f7", foreground: "#25759a" },
  trino: { text: "TR", background: "#f4eafa", foreground: "#6e3f87" },
};

const SIZE_CLASSES = {
  sm: "h-7 w-7 rounded-md text-[9px]",
  md: "h-9 w-9 rounded-lg text-[10px]",
  lg: "h-11 w-11 rounded-xl text-[11px]",
} as const;

export function DataSourceMark({ type, size = "md", className }: DataSourceMarkProps) {
  const mark = MARKS[type];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-bold tracking-[-0.04em] shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.3)]",
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: mark.background, color: mark.foreground }}
    >
      {mark.text}
    </span>
  );
}
