"use client";

import { Buildings, Graph, PlugsConnected, SlidersHorizontal } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface PlatformSettingsTabsProps {
  readonly model: ReactNode;
  readonly operations: ReactNode;
  readonly semantic: ReactNode;
  readonly extensions: ReactNode;
}

const TABS = [
  { id: "model", label: "模型配置", icon: SlidersHorizontal },
  { id: "operations", label: "组织与运维", icon: Buildings },
  { id: "semantic", label: "语义管理", icon: Graph },
  { id: "extensions", label: "扩展", icon: PlugsConnected },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function PlatformSettingsTabs({
  model,
  operations,
  semantic,
  extensions,
}: PlatformSettingsTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("model");
  const content = { model, operations, semantic, extensions }[activeTab];

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <div
        role="tablist"
        aria-label="平台设置分类"
        className="surface-floating flex gap-1 overflow-x-auto rounded-[var(--radius-item)] border border-[var(--color-border-default)] p-1 lg:sticky lg:top-5 lg:flex-col lg:overflow-visible lg:p-2"
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
                "relative inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] lg:w-full",
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-selection-selected-title)] shadow-[inset_0_0_0_1px_var(--color-selection-border)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]",
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
        className="min-w-0 rounded-[var(--radius-panel)] lg:pt-1"
      >
        {content}
      </section>
    </div>
  );
}
