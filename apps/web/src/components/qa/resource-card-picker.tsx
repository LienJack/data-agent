"use client";

import {
  ArrowClockwise,
  CaretDown,
  Check,
  CircleNotch,
  WarningCircle,
} from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ResourceCardPickerOption {
  id: string;
  title: string;
  description: string;
  mark: ReactNode;
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface ResourceCardPickerProps {
  label: string;
  value: string;
  placeholder: string;
  options: readonly ResourceCardPickerOption[];
  onChange: (value: string) => void | Promise<void>;
  placement?: "top" | "bottom";
  align?: "left" | "right";
  compact?: boolean;
  disabled?: boolean;
  pending?: boolean;
  status?: "idle" | "loading" | "ready" | "empty" | "error";
  error?: string;
  onRetry?: () => void;
}

export function ResourceCardPicker({
  label,
  value,
  placeholder,
  options,
  onChange,
  placement = "bottom",
  align = "left",
  compact = false,
  disabled = false,
  pending = false,
  status = "ready",
  error,
  onRetry,
}: ResourceCardPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selected = options.find((option) => option.id === value);
  const availableIndexes = options.flatMap((option, index) => (option.disabled ? [] : [index]));

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex((option) => option.id === value && !option.disabled);
    const nextIndex = selectedIndex >= 0 ? selectedIndex : (availableIndexes[0] ?? 0);
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [availableIndexes[0], open, options, value]);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleSelect = async (nextValue: string) => {
    await onChange(nextValue);
    close();
  };

  const moveFocus = (direction: 1 | -1) => {
    if (availableIndexes.length === 0) return;
    const currentPosition = availableIndexes.indexOf(activeIndex);
    const nextPosition =
      currentPosition < 0
        ? 0
        : (currentPosition + direction + availableIndexes.length) % availableIndexes.length;
    const nextIndex = availableIndexes[nextPosition] ?? 0;
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextIndex = event.key === "Home" ? availableIndexes[0] : availableIndexes.at(-1);
      if (nextIndex !== undefined) {
        setActiveIndex(nextIndex);
        optionRefs.current[nextIndex]?.focus();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const unavailable = status === "loading" || pending;
  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-haspopup="listbox"
        aria-label={`选择${label}，当前：${selected?.title ?? placeholder}`}
        aria-busy={pending || status === "loading"}
        disabled={disabled || unavailable}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "group flex min-w-0 items-center gap-2 rounded-xl border border-transparent text-left transition-[background-color,border-color,color] duration-150",
          compact ? "h-9 max-w-[15rem] px-2.5" : "min-h-11 min-w-44 px-3 py-2",
          disabled || unavailable
            ? "cursor-not-allowed text-[var(--color-text-muted)] opacity-60"
            : "hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-canvas)]",
          open && "border-[var(--color-border-focused)] bg-[var(--color-bg-canvas)]",
        )}
      >
        {unavailable ? (
          <CircleNotch className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          (selected?.mark ?? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-tertiary)] text-[10px] font-semibold">
              {label.slice(0, 1)}
            </span>
          ))
        )}
        <span className="min-w-0 flex-1">
          {!compact && (
            <span className="block text-[10px] font-medium tracking-[0.06em] text-[var(--color-text-muted)]">
              {label}
            </span>
          )}
          <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">
            {pending ? "正在切换…" : (selected?.title ?? placeholder)}
          </span>
        </span>
        <CaretDown
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`可用${label}`}
          onKeyDown={handleListKeyDown}
          className={cn(
            "absolute z-50 w-[calc(100vw-6rem)] overflow-hidden rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] shadow-[0_20px_55px_rgb(27_35_31_/_0.16)] md:w-[min(31rem,calc(100vw-20rem))]",
            placement === "top" ? "bottom-[calc(100%+10px)]" : "top-[calc(100%+10px)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">选择{label}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                切换后将冻结到本次对话
              </p>
            </div>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {options.filter((option) => !option.disabled).length} 个可用
            </span>
          </div>

          {status === "error" ? (
            <div className="flex min-h-32 flex-col items-center justify-center px-6 py-5 text-center">
              <WarningCircle
                className="mb-2 size-5 text-[var(--color-status-danger)]"
                aria-hidden="true"
              />
              <p className="text-xs text-[var(--color-text-secondary)]">
                {error ?? `加载${label}失败`}
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-bg-canvas)]"
                >
                  <ArrowClockwise className="size-3.5" aria-hidden="true" />
                  重试
                </button>
              )}
            </div>
          ) : options.length === 0 ? (
            <div className="min-h-28 px-6 py-8 text-center text-xs text-[var(--color-text-muted)]">
              暂无可用{label}，请先前往设置完成配置。
            </div>
          ) : (
            <div className="grid max-h-[min(22rem,55vh)] grid-cols-1 gap-1.5 overflow-y-auto p-2 sm:grid-cols-2">
              {options.map((option, index) => (
                <button
                  key={option.id}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={value === option.id}
                  aria-disabled={option.disabled || undefined}
                  tabIndex={index === activeIndex ? 0 : -1}
                  disabled={option.disabled}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => handleSelect(option.id)}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    value === option.id
                      ? "border-[var(--color-border-focused)] bg-[var(--color-selection-selected-bg)]"
                      : "border-transparent hover:border-[var(--color-border-default)] hover:bg-[var(--color-bg-canvas)]",
                    option.disabled && "cursor-not-allowed opacity-45",
                  )}
                >
                  {option.mark}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
                        {option.title}
                      </span>
                      {option.badge && (
                        <span className="rounded-full border border-[var(--color-border-default)] px-1.5 py-0.5 text-[9px] leading-none text-[var(--color-text-muted)]">
                          {option.badge}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-[var(--color-text-muted)]">
                      {option.disabledReason ?? option.description}
                    </span>
                  </span>
                  {value === option.id && (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white">
                      <Check className="size-3" weight="bold" aria-hidden="true" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
