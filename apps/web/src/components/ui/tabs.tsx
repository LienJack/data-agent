import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
  badge?: number | string;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  className?: string;
  onChange?: (tabId: string) => void;
}

export function Tabs({ tabs, defaultTab, className, onChange }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    onChange?.(tabId);
  };

  const activeContent = tabs.find((t) => t.id === activeTab)?.content;

  return (
    <div className={className}>
      <div
        role="tablist"
        className="surface-control flex w-fit max-w-full gap-0.5 overflow-x-auto p-1"
      >
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab}
            disabled={tab.disabled}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              "control-pressable relative flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-xs font-medium",
              tab.id === activeTab
                ? "bg-[var(--color-bg-surface)] text-[var(--color-accent)] shadow-[0_1px_3px_rgb(42_66_138_/_0.14)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              tab.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {tab.label}
            {tab.badge != null && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent-soft)] px-1 text-[10px] font-semibold text-[var(--color-accent)]">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4">
        {activeContent}
      </div>
    </div>
  );
}
