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
      <div role="tablist" className="flex border-b border-[var(--color-border)]">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab}
            disabled={tab.disabled}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              tab.id === activeTab
                ? "text-[var(--color-accent)] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              tab.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {tab.label}
            {tab.badge != null && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-medium text-white">
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
