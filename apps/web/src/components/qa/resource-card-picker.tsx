"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ResourceCardPickerOption {
  id: string;
  title: string;
  description: string;
  mark: ReactNode;
  badge?: string;
}

interface ResourceCardPickerProps {
  label: string;
  value: string;
  placeholder: string;
  options: readonly ResourceCardPickerOption[];
  onChange: (value: string) => void | Promise<void>;
}

export function ResourceCardPicker({
  label,
  value,
  placeholder,
  options,
  onChange,
}: ResourceCardPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSelect = async (nextValue: string) => {
    await onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group flex min-w-44 items-center gap-2 rounded-lg border bg-[var(--color-bg-primary)] px-2.5 py-2 text-left shadow-[0_1px_2px_rgb(23_26_24_/_0.03)]",
          "hover:-translate-y-px hover:border-[var(--color-border-focused)] hover:shadow-[0_5px_16px_rgb(23_26_24_/_0.07)]",
          open
            ? "border-[var(--color-border-focused)] ring-2 ring-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
            : "border-[var(--color-border-default)]",
        )}
      >
        {selected?.mark ?? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-tertiary)] text-xs font-semibold text-[var(--color-text-muted)]">
            +
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            {label}
          </span>
          <span className="block truncate text-xs font-semibold text-[var(--color-text-primary)]">
            {selected?.title ?? placeholder}
          </span>
        </span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform",
            open && "rotate-180",
          )}
        >
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-[calc(100%+8px)] z-40 w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-2 shadow-[0_18px_45px_rgb(23_26_24_/_0.14)]"
        >
          <div className="mb-1 flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
              选择{label}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {options.length} 个可用项
            </span>
          </div>
          <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => handleSelect("")}
              className={cn(
                "flex min-h-16 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all",
                value === ""
                  ? "border-[var(--color-border-focused)] bg-[var(--color-selection-selected-bg)]"
                  : "border-transparent hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-canvas)]",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--color-border-overlay)] text-xs text-[var(--color-text-muted)]">
                A
              </span>
              <span>
                <span className="block text-xs font-semibold text-[var(--color-text-primary)]">
                  {placeholder}
                </span>
                <span className="block text-[10px] text-[var(--color-text-muted)]">
                  由系统在运行时解析
                </span>
              </span>
            </button>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={value === option.id}
                onClick={() => handleSelect(option.id)}
                className={cn(
                  "flex min-h-16 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all",
                  value === option.id
                    ? "border-[var(--color-border-focused)] bg-[var(--color-selection-selected-bg)]"
                    : "border-transparent hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-canvas)]",
                )}
              >
                {option.mark}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
                      {option.title}
                    </span>
                    {option.badge && (
                      <span className="rounded border border-[var(--color-border-default)] px-1 py-0.5 text-[9px] leading-none text-[var(--color-text-muted)]">
                        {option.badge}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-muted)]">
                    {option.description}
                  </span>
                </span>
                {value === option.id && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-accent)] text-[9px] text-white">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
