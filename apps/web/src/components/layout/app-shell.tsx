import type { ReactNode } from "react";
import { NavBar } from "./nav-bar";

interface AppShellProps {
  children: ReactNode;
}

/**
 * 应用外壳布局。
 * 包含顶部导航栏和主内容区。
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[var(--color-bg-secondary)]">
      <NavBar />
      <main>{children}</main>
    </div>
  );
}
