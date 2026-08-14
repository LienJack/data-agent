"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
}

const navItems: NavItem[] = [
  { label: "分析工作台", href: "/" },
  { label: "语义审核", href: "/semantic" },
];

/**
 * 紧凑导航栏 — 参考 DataFoundry 设计。
 *
 * 信息密度高，去除装饰元素，采用语义化色彩。
 */
export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="flex h-9 shrink-0 items-center border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)]"
        >
          Data Agent
        </Link>
        <nav className="flex items-center gap-0.5">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="rounded border border-[var(--color-border-default)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          M1 Demo
        </span>
      </div>
    </header>
  );
}
