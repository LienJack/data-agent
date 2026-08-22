"use client";

import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ThemeMode = "system" | "light" | "dark";

const modes = [
  { id: "system", label: "跟随系统", icon: Desktop },
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
] as const;

function applyTheme(mode: ThemeMode) {
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = mode;
  }
  localStorage.setItem("data-agent-theme", mode);
}

export function ThemeModeControl() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const saved = localStorage.getItem("data-agent-theme");
    if (saved === "light" || saved === "dark" || saved === "system") {
      setMode(saved);
      applyTheme(saved);
    }
  }, []);

  return (
    <section className="surface-reading mt-5 flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[var(--color-border-default)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold">界面外观</h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          蓝色品牌主题支持系统、浅色与深色外观。
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="界面外观"
        className="surface-control flex w-fit max-w-full gap-1 overflow-x-auto p-1"
      >
        {modes.map((item) => {
          const selected = mode === item.id;
          const Icon = item.icon;
          return (
            <label
              key={item.id}
              className={cn(
                "inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[calc(var(--radius-control)-3px)] px-2.5 text-xs font-medium transition-colors",
                selected
                  ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
              )}
            >
              <input
                type="radio"
                name="interface-theme"
                value={item.id}
                checked={selected}
                onChange={() => {
                  setMode(item.id);
                  applyTheme(item.id);
                }}
                className="sr-only"
              />
              <Icon size={14} weight={selected ? "fill" : "regular"} />
              {item.label}
            </label>
          );
        })}
      </div>
    </section>
  );
}
