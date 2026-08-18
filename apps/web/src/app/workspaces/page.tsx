import { ArrowUpRight, Buildings, Warning } from "@phosphor-icons/react/dist/ssr";
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
    <main className="min-h-[100dvh] bg-[var(--color-bg-secondary)]">
      <div className="page-frame max-w-6xl">
        <header className="page-heading">
          <div>
            <p className="page-eyebrow">Data Agent / Workspaces</p>
            <h1 className="page-title">选择分析工作空间</h1>
            <p className="page-description font-mono text-[11px]">
              当前账号：{session.value.principal_id} · {session.value.system_role}
            </p>
          </div>
          <AccountControls />
        </header>

        {workspaces.value.length === 0 ? (
          <section className="mt-10 border-y border-dashed border-[var(--color-border-default)] py-16 text-center">
            <Buildings
              aria-hidden="true"
              className="mx-auto text-[var(--color-text-muted)]"
              size={28}
            />
            <h2 className="text-base font-semibold">尚无可访问的工作空间</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              请联系超级管理员创建工作空间并分配成员角色。
            </p>
          </section>
        ) : (
          <section className="mt-8 grid gap-3 md:grid-cols-2">
            {workspaces.value.map((access) => (
              <Link
                key={access.workspace.workspace_id}
                href={`/w/${access.workspace.workspace_id}`}
                className="group rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-float)] hover:-translate-y-0.5 hover:border-[var(--color-border-focused)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{access.workspace.display_name}</h2>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {access.workspace.slug}
                    </p>
                  </div>
                  <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-[9px] font-semibold text-emerald-700">
                    {access.role}
                  </span>
                </div>
                <div className="mt-6 flex items-center justify-between text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)]">
                  <span>进入工作空间</span>
                  <ArrowUpRight aria-hidden="true" size={17} />
                </div>
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
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--color-bg-secondary)] p-6">
      <section className="w-full max-w-md border-l-2 border-amber-500 bg-amber-50 px-5 py-4">
        <Warning aria-hidden="true" className="mb-3 text-amber-700" size={22} />
        <h1 className="font-semibold text-amber-900">身份服务尚未就绪</h1>
        <p className="mt-2 text-sm text-amber-800">{message}</p>
      </section>
    </main>
  );
}
