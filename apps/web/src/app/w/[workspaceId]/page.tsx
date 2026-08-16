import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountControls } from "@/components/workspaces/account-controls";
import { isBillingUiEnabled } from "@/lib/billing-ui";
import {
  getCurrentWorkspaceSession,
  listSessionWorkspaces,
  resolveSessionWorkspaceCapability,
} from "@/lib/workspace-identity";
import { navigationForWorkspace } from "@/lib/workspace-navigation";

export default async function WorkspaceHomePage({
  params,
}: {
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
  const billingUiEnabled = isBillingUiEnabled();
  const navigation = navigationForWorkspace(access);

  return (
    <main className="min-h-screen bg-[var(--color-bg-secondary)] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl border border-[var(--color-border-default)] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                  {access.role}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {access.workspace.slug}
                </span>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">
                {access.workspace.display_name}
              </h1>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                workspace_id / tenant_id：{access.workspace.workspace_id}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/workspaces"
                className="rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-xs font-medium hover:bg-[var(--color-bg-tertiary)]"
              >
                切换工作空间
              </Link>
              <AccountControls />
            </div>
          </div>
        </header>

        <section
          className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label="按角色过滤的导航"
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-[var(--color-border-default)] bg-white p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{item.label}</h2>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-700">
                  {item.phase === "AVAILABLE" ? "可用" : "后续阶段"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                {!billingUiEnabled && item.key === "platform-settings"
                  ? "管理账户、工作空间与语义资产"
                  : item.description}
              </p>
            </Link>
          ))}
        </section>

        <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
          身份、工作空间、数据源、对话、Schema Discovery 与语义请求均由当前 capability 隔离；
          {billingUiEnabled
            ? "平台模型与计费控制面将在后续阶段继续接入。"
            : "平台级扩展能力将在后续阶段继续接入。"}
        </section>
      </div>
    </main>
  );
}
