import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountControls } from "@/components/workspaces/account-controls";
import { getCurrentWorkspaceSession, listSessionWorkspaces } from "@/lib/workspace-identity";

export default async function WorkspacePickerPage() {
  const session = await getCurrentWorkspaceSession();
  if (!session.ok) {
    if (session.error.code.startsWith("AUTH_SESSION_")) redirect("/login");
    return <IdentityUnavailable message={session.error.message} />;
  }
  const workspaces = await listSessionWorkspaces(session.value);
  if (!workspaces.ok) return <IdentityUnavailable message={workspaces.error.message} />;
  if (workspaces.value.length === 1) {
    redirect(`/w/${workspaces.value[0]?.workspace.workspace_id}`);
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg-secondary)] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              工作空间
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">选择分析工作空间</h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              当前账号：{session.value.principal_id} · {session.value.system_role}
            </p>
          </div>
          <AccountControls />
        </header>

        {workspaces.value.length === 0 ? (
          <section className="mt-10 rounded-2xl border border-dashed border-[var(--color-border-default)] bg-white p-10 text-center">
            <h2 className="text-base font-semibold">尚无可访问的工作空间</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              请联系超级管理员创建工作空间并分配成员角色。
            </p>
          </section>
        ) : (
          <section className="mt-10 grid gap-4 md:grid-cols-2">
            {workspaces.value.map((access) => (
              <Link
                key={access.workspace.workspace_id}
                href={`/w/${access.workspace.workspace_id}`}
                className="group rounded-2xl border border-[var(--color-border-default)] bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--color-border-focused)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{access.workspace.display_name}</h2>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {access.workspace.slug}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                    {access.role}
                  </span>
                </div>
                <p className="mt-6 text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]">
                  进入工作空间 →
                </p>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function IdentityUnavailable({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)] p-6">
      <section className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="font-semibold text-amber-900">身份服务尚未就绪</h1>
        <p className="mt-2 text-sm text-amber-800">{message}</p>
      </section>
    </main>
  );
}
