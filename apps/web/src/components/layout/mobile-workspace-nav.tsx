"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import type { WorkspaceNavigationItem, WorkspaceNavigationKey } from "@/lib/workspace-navigation";
import { WorkspaceNavIcon } from "./workspace-nav-icon";

const labels: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  qa: "workspace.surface.qa",
  tests: "workspace.surface.tests",
  jobs: "workspace.surface.jobs",
  "data-sources": "workspace.surface.data-sources",
  knowledge: "workspace.surface.knowledge",
  semantic: "workspace.surface.semantic",
  members: "workspace.surface.members",
  "platform-settings": "workspace.surface.platform-settings",
};

const primaryKeys = new Set<WorkspaceNavigationKey>([
  "qa",
  "data-sources",
  "knowledge",
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
      className="surface-floating-strong fixed inset-x-0 bottom-0 z-20 grid h-16 border-t px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-pressable="true"
            className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] text-[9px] font-medium ${
              active
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            <span
              className={`grid size-8 place-items-center rounded-[9px] ${
                active ? "bg-[var(--color-accent-soft)]" : ""
              }`}
            >
              <WorkspaceNavIcon navigationKey={item.key} size={19} />
            </span>
            <span className="max-w-full truncate">{t(labels[item.key])}</span>
          </Link>
        );
      })}
    </nav>
  );
}
