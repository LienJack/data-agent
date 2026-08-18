"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import type { WorkspaceNavigationItem, WorkspaceNavigationKey } from "@/lib/workspace-navigation";
import { WorkspaceNavIcon } from "./workspace-nav-icon";

const labels: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  analysis: "workspace.surface.analysis",
  qa: "workspace.surface.qa",
  tests: "workspace.surface.tests",
  jobs: "workspace.surface.jobs",
  "data-sources": "workspace.surface.data-sources",
  semantic: "workspace.surface.semantic",
  members: "workspace.surface.members",
  "platform-settings": "workspace.surface.platform-settings",
};

const primaryKeys = new Set<WorkspaceNavigationKey>([
  "analysis",
  "qa",
  "data-sources",
  "semantic",
  "platform-settings",
]);

export function MobileWorkspaceNav({
  navigation,
}: {
  readonly navigation: readonly WorkspaceNavigationItem[];
}) {
  const pathname = usePathname();
  const { t } = useWorkspaceI18n();
  const items = navigation.filter((item) => primaryKeys.has(item.key)).slice(0, 5);

  return (
    <nav
      aria-label={t("workspace.resources")}
      className="fixed inset-x-0 bottom-0 z-20 grid h-16 border-t border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-bg-surface)_94%,transparent)] px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_-28px_rgb(23_32_28_/_55%)] backdrop-blur-xl lg:hidden"
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-1 text-[9px] font-medium ${
              active
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {active && <span className="absolute inset-x-4 top-0 h-0.5 bg-[var(--color-accent)]" />}
            <WorkspaceNavIcon navigationKey={item.key} size={19} />
            <span className="max-w-full truncate">{t(labels[item.key])}</span>
          </Link>
        );
      })}
    </nav>
  );
}
