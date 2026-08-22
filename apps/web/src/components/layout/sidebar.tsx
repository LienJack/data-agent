"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { Plus, SidebarSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import { useLayoutStore, useSidebarCollapsed } from "@/lib/layout-store";
import { useQAStore } from "@/lib/qa-store";
import { useWorkbenchStore } from "@/lib/workbench-store";
import type { WorkspaceNavigationItem, WorkspaceNavigationKey } from "@/lib/workspace-navigation";
import { workspacePath } from "@/lib/workspace-routes";
import { ConversationDirectory } from "../qa/conversation-directory";
import { SidebarItem } from "./sidebar-item";
import { WorkspaceNavIcon } from "./workspace-nav-icon";

const navigationLabels: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  qa: "workspace.surface.qa",
  tests: "workspace.surface.tests",
  jobs: "workspace.surface.jobs",
  "data-sources": "workspace.surface.data-sources",
  knowledge: "workspace.surface.knowledge",
  semantic: "workspace.surface.semantic",
  members: "workspace.surface.members",
  "platform-settings": "workspace.surface.platform-settings",
};

interface SidebarProps {
  readonly access: WorkspaceAccessProjection;
  readonly navigation: readonly WorkspaceNavigationItem[];
}

/**
 * Data Agent 工作区侧栏。
 *
 * 导航围绕业务分析、数据连接和语义治理能力组织；最近分析来自真实 store，
 * 底部能力状态来自 Workbench authority，不在视觉层伪造用户或环境信息。
 */
export function Sidebar({ access, navigation }: SidebarProps) {
  const { t } = useWorkspaceI18n();
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const loadConversations = useQAStore((state) => state.loadConversations);
  const coreL2Verdict = useWorkbenchStore((state) => state.coreL2Verdict);
  const attributionF9Status = useWorkbenchStore((state) => state.attributionF9Status);
  const workspaceId = access.workspace.workspace_id;
  const workspaceHome = workspacePath(workspaceId);
  const qaItem = navigation.find((item) => item.key === "qa");
  const isQaSurface = Boolean(
    qaItem && (pathname === qaItem.href || pathname.startsWith(`${qaItem.href}/`)),
  );

  useEffect(() => {
    if (isQaSurface) void loadConversations();
  }, [isQaSurface, loadConversations]);

  return (
    <aside
      className={[
        "surface-floating hidden h-full shrink-0 flex-col border-r transition-[width] duration-200 lg:flex",
        collapsed ? "w-16" : "w-[248px]",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-14 shrink-0 items-center border-b border-[var(--color-border-default)]",
          collapsed ? "justify-center px-2" : "gap-3 px-3",
        ].join(" ")}
      >
        {!collapsed && (
          <Link
            href={workspaceHome}
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-text-primary)] text-[11px] font-semibold text-white"
            aria-label={`data agent ${t("workspace.home")}`}
          >
            DA
          </Link>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">data agent</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {access.workspace.display_name} · {access.role}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex size-8 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          aria-label={collapsed ? t("workspace.expandSidebar") : t("workspace.collapseSidebar")}
        >
          <SidebarSimple aria-hidden="true" size={17} />
        </button>
      </div>

      <div data-directory-menu-boundary className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <nav className="px-2 py-4" aria-label={t("workspace.resources")}>
          {!collapsed && (
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              {t("workspace.analysisGovernance")}
            </p>
          )}
          <div className="space-y-0.5">
            {navigation.map((item) => (
              <SidebarItem
                key={item.href}
                href={item.href}
                label={t(navigationLabels[item.key])}
                icon={<WorkspaceNavIcon navigationKey={item.key} />}
                collapsed={collapsed}
              />
            ))}
          </div>
        </nav>

        {!collapsed && qaItem && isQaSurface && (
          <section
            className="border-t border-[var(--color-border-default)] px-3 py-3"
            aria-label={t("workspace.surface.qa")}
          >
            <Link
              href={qaItem.href}
              data-pressable="true"
              className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-accent)] text-[12px] font-semibold text-white shadow-[0_8px_18px_-12px_rgb(38_71_168_/_0.72)] hover:bg-[var(--color-accent-hover)]"
            >
              <Plus aria-hidden="true" size={14} />
              {t("workspace.newQuestion")}
            </Link>

            <ConversationDirectory qaHref={qaItem.href} className="mt-3" />
          </section>
        )}
      </div>

      {!collapsed && (
        <div className="relative z-0 shrink-0 border-t border-[var(--color-border-default)] px-3 py-2">
          <div className="flex min-h-12 items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-control)] border border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700">
              L2
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium">Core L2 · {coreL2Verdict}</div>
              <div className="truncate text-[10px] text-[var(--color-text-muted)]">
                Published F9 · {attributionF9Status}
              </div>
            </div>
            <span className="size-2 rounded-full bg-amber-400" title="交付状态 HOLD" />
          </div>
          <a
            href="/workspaces"
            className="mt-1 flex h-7 items-center justify-center rounded-md text-[11px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            {t("workspace.switch")}
          </a>
        </div>
      )}
    </aside>
  );
}
