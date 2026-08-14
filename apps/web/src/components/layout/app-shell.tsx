"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";

interface AppShellProps {
  children: ReactNode;
}

/**
 * 应用外壳布局 — 参考 DataFoundry 工作区模式。
 *
 * 结构（从上到下）：
 * 1. NavBar（紧凑导航栏）
 * 2. Main（可滚动主内容区）
 * 3. StatusBar（紧凑底部状态栏）
 *
 * 全高 flex 布局，信息密度高，装饰元素少。
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const usesIdentityShell =
    pathname === "/login" || pathname === "/workspaces" || pathname.startsWith("/w/");
  if (usesIdentityShell) return <>{children}</>;
  const usesEmbeddedRunStatus = pathname === "/" || pathname === "/qa";

  return (
    <div className="flex h-screen flex-row bg-[var(--color-bg-canvas)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        {!usesEmbeddedRunStatus && <StatusBar />}
      </div>
    </div>
  );
}
