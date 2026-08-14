"use client";

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
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)] px-6 py-12">
      <section className="w-full max-w-[420px] rounded-2xl border border-[var(--color-border-default)] bg-white p-8 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-xl bg-[#171a18] text-sm font-bold text-white">
          DA
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">登录 Data Agent</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          账号由超级管理员创建，系统不开放自主注册。
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">邮箱</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-2 h-11 w-full rounded-lg border border-[var(--color-border-default)] px-3 text-sm outline-none focus:border-[var(--color-border-focused)]"
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
              className="mt-2 h-11 w-full rounded-lg border border-[var(--color-border-default)] px-3 text-sm outline-none focus:border-[var(--color-border-focused)]"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="h-11 w-full rounded-lg bg-[#171a18] text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
          >
            {pending ? "正在验证…" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
