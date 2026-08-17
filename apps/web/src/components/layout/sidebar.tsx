"use client";

import type { WorkspaceAccessProjection } from "@data-agent/contracts";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useLayoutStore, useSidebarCollapsed } from "@/lib/layout-store";
import { useQAConversations, useQAStore } from "@/lib/qa-store";
import { useWorkbenchStore } from "@/lib/workbench-store";
import type { WorkspaceNavigationItem, WorkspaceNavigationKey } from "@/lib/workspace-navigation";
import { workspacePath } from "@/lib/workspace-routes";
import { SidebarItem } from "./sidebar-item";

const iconClassName = "h-4 w-4";

const icons = {
  workbench: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <path d="M3 15.5V11m4 4.5V7m4 8.5V4m4 11.5V9" />
    </svg>
  ),
  review: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <path d="M5 3.5h10v13H5z" />
      <path d="m7.5 10 1.5 1.5 3.5-4" />
    </svg>
  ),
  dataSources: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <ellipse cx="10" cy="4.5" rx="6" ry="2.5" />
      <path d="M4 4.5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5M4 9.5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" />
    </svg>
  ),
  qa: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <path d="M3.5 4.5h13v9h-7l-3.5 3v-3H3.5z" />
    </svg>
  ),
  tests: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <path d="M6 3.5h8M7 3.5v4l-3.5 6.2A2 2 0 0 0 5.2 16.5h9.6a2 2 0 0 0 1.7-2.8L13 7.5v-4" />
      <path d="M6 12h8" />
    </svg>
  ),
  jobs: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <path d="M4 4.5h12v11H4zM7 2.5v4M13 2.5v4M7 10h6M7 13h4" />
    </svg>
  ),
  settings: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />
    </svg>
  ),
  members: (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={iconClassName}
    >
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="14" cy="8" r="2" />
      <path d="M2.8 16c.4-3 2-4.5 4.4-4.5s4 1.5 4.4 4.5M11.5 12c2.8-.4 4.7.9 5.2 3.5" />
    </svg>
  ),
};

const navigationIcons: Readonly<Record<WorkspaceNavigationKey, ReactNode>> = {
  analysis: icons.workbench,
  qa: icons.qa,
  tests: icons.tests,
  jobs: icons.jobs,
  "data-sources": icons.dataSources,
  semantic: icons.review,
  members: icons.members,
  "platform-settings": icons.settings,
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
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      conversation.title.toLocaleLowerCase("zh-CN").includes(query),
    );
  }, [conversations, search]);

  return (
    <aside
      className={[
        "flex h-full shrink-0 flex-col border-r border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] transition-[width] duration-200",
        collapsed ? "w-[56px]" : "w-[288px]",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-[72px] shrink-0 items-center border-b border-[var(--color-border-default)]",
          collapsed ? "justify-center px-2" : "gap-3 px-3",
        ].join(" ")}
      >
        {!collapsed && (
          <Link
            href={workspaceHome}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-white text-sm font-semibold text-[var(--color-text-primary)] shadow-sm"
            aria-label="data agent 首页"
          >
            D
          </Link>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">data agent</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {access.workspace.display_name} · {access.role}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex size-8 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="size-4"
          >
            <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
            <path d="M8 4v12" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <nav className="px-2 py-4" aria-label="工作区资源">
          {!collapsed && (
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              分析与治理
            </p>
          )}
          <div className="space-y-0.5">
            {navigation.map((item) => (
              <SidebarItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={navigationIcons[item.key]}
                collapsed={collapsed}
              />
            ))}
          </div>
        </nav>

        {!collapsed && qaItem && (
          <section
            className="border-t border-[var(--color-border-default)] px-3 py-3"
            aria-label="数据任务"
          >
            <Link
              href={qaItem.href}
              className="flex h-10 items-center justify-center rounded-lg bg-[#171a18] text-[13px] font-semibold text-white shadow-sm hover:bg-black"
            >
              新建业务问题
            </Link>

            <label className="relative mt-3 block">
              <span className="sr-only">搜索会话</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]"
              >
                <circle cx="8.5" cy="8.5" r="4.5" />
                <path d="m12 12 4 4" />
              </svg>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索最近分析"
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
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]"
                  >
                    <path d="M3.5 4.5h13v9h-7l-3.5 3v-3H3.5z" />
                  </svg>
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
                    router.push(qaItem.href);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/70"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]"
                  >
                    <path d="M3.5 4.5h13v9h-7l-3.5 3v-3H3.5z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-secondary)]">
                    {conversation.title}
                  </span>
                </button>
              ))}

              {!projection && filteredConversations.length === 0 && (
                <p className="px-2 py-4 text-center text-[11px] text-[var(--color-text-muted)]">
                  暂无会话
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
            切换工作空间
          </a>
        </div>
      )}
    </aside>
  );
}
