"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SidebarItemProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  collapsed?: boolean;
  count?: number;
}

/**
 * 侧边栏导航项 — 参考 DataFoundry 侧边栏设计。
 *
 * 展开时显示图标 + 标签，折叠时仅显示图标。
 * 当前路径高亮显示。
 */
export function SidebarItem({ href, label, icon, collapsed, count }: SidebarItemProps) {
  const pathname = usePathname();

  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
        collapsed ? "justify-center px-2" : "",
        isActive
          ? "bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]",
      )}
      title={collapsed ? label : undefined}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && count !== undefined && (
        <span className="ml-auto text-[11px] font-normal text-[var(--color-text-muted)]">
          {count}
        </span>
      )}
    </Link>
  );
}
