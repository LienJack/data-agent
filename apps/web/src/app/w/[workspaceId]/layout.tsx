import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  getCurrentWorkspaceSession,
  listSessionWorkspaces,
  resolveSessionWorkspaceCapability,
} from "@/lib/workspace-identity";
import { navigationForWorkspace } from "@/lib/workspace-navigation";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) redirect("/login");
  const [workspaces, capability] = await Promise.all([
    listSessionWorkspaces(session.value),
    resolveSessionWorkspaceCapability(session.value, workspaceId),
  ]);
  if (!workspaces.ok || !capability.ok) redirect("/workspaces");
  const access = workspaces.value.find(
    (candidate) => candidate.workspace.workspace_id === workspaceId,
  );
  if (!access) redirect("/workspaces");
  const navigation = navigationForWorkspace(access);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg-secondary)]">
      <header className="border-b border-[var(--color-border-default)] bg-white px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <Link href={`/w/${workspaceId}`} className="text-sm font-semibold">
            {access.workspace.display_name}
          </Link>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
            {access.role}
          </span>
          <nav className="ml-auto flex flex-wrap items-center gap-1" aria-label="工作空间导航">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/workspaces"
              className="rounded-lg px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
            >
              切换
            </Link>
          </nav>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
