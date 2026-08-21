"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import { ChatCircleDots, MagnifyingGlass, Plus, SidebarSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { MessageKey } from "@/i18n";
import { useWorkspaceI18n } from "@/i18n";
import { useLayoutStore, useSidebarCollapsed } from "@/lib/layout-store";
import { qaConversationHref } from "@/lib/qa-inspector-target";
import { useQAConversations, useQAStore } from "@/lib/qa-store";
import { useWorkbenchStore } from "@/lib/workbench-store";
import type { WorkspaceNavigationItem, WorkspaceNavigationKey } from "@/lib/workspace-navigation";
import { workspacePath } from "@/lib/workspace-routes";
import { SidebarItem } from "./sidebar-item";
import { WorkspaceNavIcon } from "./workspace-nav-icon";

const navigationLabels: Readonly<Record<WorkspaceNavigationKey, MessageKey>> = {
  analysis: "workspace.surface.analysis",
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
  const { locale, t } = useWorkspaceI18n();
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useSidebarCollapsed();
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const loadConversations = useQAStore((state) => state.loadConversations);
  const selectConversation = useQAStore((state) => state.selectConversation);
  const conversations = useQAConversations();
  const projection = useWorkbenchStore((state) => state.projection);
  const coreL2Verdict = useWorkbenchStore((state) => state.coreL2Verdict);
  const attributionF9Status = useWorkbenchStore((state) => state.attributionF9Status);
  const [search, setSearch] = useState("");
  const workspaceId = access.workspace.workspace_id;
  const workspaceHome = workspacePath(workspaceId);
  const analysisItem = navigation.find((item) => item.key === "analysis");
  const qaItem = navigation.find((item) => item.key === "qa");

  useEffect(() => {
    if (qaItem) void loadConversations();
  }, [loadConversations, qaItem]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      conversation.title.toLocaleLowerCase(locale).includes(query),
    );
  }, [conversations, locale, search]);

  return (
    <aside
      className={[
        "hidden h-full shrink-0 flex-col border-r border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] transition-[width] duration-200 lg:flex",
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

      <div className="min-h-0 flex-1 overflow-y-auto">
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

        {!collapsed && qaItem && (
          <section
            className="border-t border-[var(--color-border-default)] px-3 py-3"
            aria-label={t("workspace.surface.qa")}
          >
            <Link
              href={qaItem.href}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--color-text-primary)] text-[12px] font-semibold text-white hover:bg-[var(--color-accent-hover)]"
            >
              <Plus aria-hidden="true" size={14} />
              {t("workspace.newQuestion")}
            </Link>

            <label className="relative mt-3 block">
              <span className="sr-only">{t("workspace.searchConversations")}</span>
              <MagnifyingGlass
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                size={15}
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("workspace.searchRecent")}
                className="h-10 w-full rounded-lg border border-[var(--color-border-default)] bg-white pl-9 pr-3 text-[13px] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
              />
            </label>

            <div className="mt-3 space-y-1">
              {projection && analysisItem && (
                <Link
                  href={analysisItem.href}
                  className={[
                    "group flex items-start gap-2 rounded-lg px-2 py-2 text-left",
                    pathname === analysisItem.href ? "bg-white shadow-sm" : "hover:bg-white/70",
                  ].join(" ")}
                >
                  <ChatCircleDots
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                    size={16}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                    {projection.question}
                  </span>
                  <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-[var(--color-success)]" />
                </Link>
              )}

              {filteredConversations.slice(0, 8).map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => {
                    void selectConversation(conversation.id);
                    router.push(qaConversationHref(qaItem.href, conversation.id));
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/70"
                >
                  <ChatCircleDots
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                    size={16}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-secondary)]">
                    {conversation.title}
                  </span>
                </button>
              ))}

              {!projection && filteredConversations.length === 0 && (
                <p className="px-2 py-4 text-center text-[11px] text-[var(--color-text-muted)]">
                  {t("workspace.noConversations")}
                </p>
              )}
            </div>
          </section>
        )}
      </div>

      {!collapsed && (
        <div className="shrink-0 border-t border-[var(--color-border-default)] px-3 py-2">
          <div className="flex min-h-12 items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700">
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
