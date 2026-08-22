import { ArrowRight, Buildings, CirclesFour, Warning } from "@phosphor-icons/react/dist/ssr";
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
    <main className="min-h-[100dvh] bg-[var(--color-bg-canvas)] px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto w-full max-w-[920px]">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-[var(--color-accent)] text-white shadow-[0_10px_24px_-14px_rgb(38_71_168_/_0.8)]">
              <CirclesFour aria-hidden="true" size={18} weight="fill" />
            </span>
            <span className="text-sm font-semibold tracking-[-0.02em]">Data Agent</span>
          </div>
          <AccountControls />
        </header>

        <section className="pb-8 pt-20 sm:pb-10 sm:pt-28">
          <p className="page-eyebrow">Your workspaces</p>
          <h1 className="page-title max-w-2xl">选择要继续工作的空间</h1>
          <p className="page-description">
            你只会看到当前身份有权访问的工作空间。角色和能力将在进入后重新校验。
          </p>
        </section>

        {workspaces.value.length === 0 ? (
          <section className="surface-reading flex min-h-64 flex-col items-center justify-center rounded-[var(--radius-panel)] border px-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-[14px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Buildings aria-hidden="true" size={22} />
            </span>
            <h2 className="mt-5 text-base font-semibold">尚无可访问的工作空间</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-text-secondary)]">
              请联系超级管理员创建工作空间并分配成员角色。
            </p>
          </section>
        ) : (
          <section
            className="surface-reading overflow-hidden rounded-[var(--radius-panel)] border"
            aria-label="可访问的工作空间"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-5 py-3.5">
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">工作空间</p>
              <p className="font-mono text-[10px] text-[var(--color-text-muted)]">
                {workspaces.value.length} AVAILABLE
              </p>
            </div>
            <div className="divide-y divide-[var(--color-border-default)]">
              {workspaces.value.map((access) => (
                <Link
                  key={access.workspace.workspace_id}
                  href={`/w/${access.workspace.workspace_id}`}
                  className="control-pressable group grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 hover:bg-[var(--color-accent-soft)] sm:px-5"
                >
                  <span className="flex size-10 items-center justify-center rounded-[12px] border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] text-sm font-semibold text-[var(--color-accent)] group-hover:border-[color-mix(in_srgb,var(--color-accent)_24%,white)] group-hover:bg-white">
                    {access.workspace.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {access.workspace.display_name}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                      {access.workspace.slug}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="hidden rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-[9px] font-semibold text-[var(--color-accent)] sm:inline">
                      {access.role}
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-accent)]"
                      size={17}
                    />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[10px] text-[var(--color-text-muted)]">
          <span className="font-mono">{session.value.principal_id}</span>
          <span className="font-mono">SYSTEM ROLE · {session.value.system_role}</span>
        </footer>
      </div>
    </main>
  );
}

function IdentityUnavailable({ message }: { message: string }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--color-bg-canvas)] p-6">
      <section className="surface-reading w-full max-w-md rounded-[var(--radius-panel)] border p-6">
        <span className="flex size-10 items-center justify-center rounded-[12px] bg-amber-50 text-amber-700">
          <Warning aria-hidden="true" size={20} weight="fill" />
        </span>
        <h1 className="mt-5 text-lg font-semibold tracking-[-0.025em]">身份服务尚未就绪</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{message}</p>
      </section>
    </main>
  );
}
