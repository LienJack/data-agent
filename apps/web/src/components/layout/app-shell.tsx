"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StatusBar } from "./status-bar";

interface AppShellProps {
  children: ReactNode;
}

/**
 * 应用外壳布局 — 参考 DataFoundry 工作区模式。
 *
 * 结构（从上到下）：
 * 工作空间业务路由由 WorkspaceShell 负责；这里只承载平台控制面和兼容入口。
 *
 * 全高 flex 布局，信息密度高，装饰元素少。
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const usesIdentityShell =
    pathname === "/login" || pathname === "/workspaces" || pathname.startsWith("/w/");
  if (usesIdentityShell) return <>{children}</>;
  const usesResponsiveControlPlaneShell =
    pathname === "/settings" || pathname.startsWith("/admin/");

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg-canvas)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {usesResponsiveControlPlaneShell && (
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border-default)] px-4">
            <Link
              href="/workspaces"
              className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]"
              aria-label="返回 data agent 首页"
            >
              <span className="flex size-7 items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white text-xs shadow-sm">
                D
              </span>
              data agent
            </Link>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              平台控制面
            </span>
          </header>
        )}
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <StatusBar />
      </div>
    </div>
  );
}
