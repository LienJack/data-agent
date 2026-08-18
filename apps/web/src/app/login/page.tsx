"use client";

import { CirclesFour, ShieldCheck } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const result = await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) {
        setError("邮箱或密码不正确，或账号已停用。");
        return;
      }
      router.replace("/workspaces");
      router.refresh();
    } catch {
      setError("登录服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-[100dvh] grid-rows-[128px_minmax(0,1fr)] bg-[var(--color-bg-surface)] lg:grid-cols-[minmax(300px,0.8fr)_minmax(520px,1.2fr)] lg:grid-rows-1">
      <aside className="relative flex min-h-28 flex-col justify-between overflow-hidden bg-[var(--color-text-primary)] p-5 text-white sm:p-8 lg:min-h-[100dvh] lg:p-10">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-white text-[var(--color-text-primary)]">
            <CirclesFour aria-hidden="true" size={19} weight="fill" />
          </span>
          <div>
            <p className="text-sm font-semibold">Data Agent</p>
            <p className="font-mono text-[9px] text-white/55">ANALYTICS CONTROL PLANE</p>
          </div>
        </div>
        <div className="hidden max-w-sm lg:block">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-4 border-t border-white/15 pt-5 text-xs">
            <ShieldCheck aria-hidden="true" className="text-emerald-300" size={18} />
            <div>
              <p className="font-medium text-white/90">Workspace authority</p>
              <p className="mt-1 leading-5 text-white/50">Identity · role · environment</p>
            </div>
          </div>
        </div>
      </aside>

      <section className="flex items-center px-5 py-12 sm:px-10 lg:px-[10vw]">
        <div className="w-full max-w-[420px]">
          <p className="page-eyebrow">Secure access</p>
          <h1 className="page-title">登录工作台</h1>
          <p className="page-description">账号由超级管理员创建，系统不开放自主注册。</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">邮箱</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-2 h-12 w-full rounded-md border border-[var(--color-border-default)] px-3 text-sm outline-none focus:border-[var(--color-border-focused)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">密码</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={12}
                required
                className="mt-2 h-12 w-full rounded-md border border-[var(--color-border-default)] px-3 text-sm outline-none focus:border-[var(--color-border-focused)]"
              />
            </label>
            {error && (
              <p
                role="alert"
                className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="h-12 w-full rounded-md bg-[var(--color-text-primary)] text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {pending ? "正在验证…" : "登录"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
