"use client";

import { Buildings, Graph, SlidersHorizontal } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface PlatformSettingsTabsProps {
  readonly model: ReactNode;
  readonly operations: ReactNode;
  readonly semantic: ReactNode;
}

const TABS = [
  { id: "model", label: "模型配置", icon: SlidersHorizontal },
  { id: "operations", label: "组织与运维", icon: Buildings },
  { id: "semantic", label: "语义管理", icon: Graph },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function PlatformSettingsTabs({ model, operations, semantic }: PlatformSettingsTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("model");
  const content = { model, operations, semantic }[activeTab];

  return (
    <div className="mt-5">
      <div
        role="tablist"
        aria-label="平台设置分类"
        className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-default)]"
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`platform-settings-panel-${tab.id}`}
              id={`platform-settings-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative inline-flex min-h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]",
                active
                  ? "text-[var(--color-text-primary)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
              )}
            >
              <Icon size={17} weight={active ? "fill" : "regular"} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <section
        role="tabpanel"
        id={`platform-settings-panel-${activeTab}`}
        aria-labelledby={`platform-settings-tab-${activeTab}`}
        className="py-7"
      >
        {content}
      </section>
    </div>
  );
}
