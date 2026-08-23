"use client";

import { ArrowRight, CirclesFour, Database, LockKey, ShieldCheck } from "@phosphor-icons/react";
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
    const identifier = String(form.get("identifier") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const result = identifier.includes("@")
        ? await authClient.signIn.email({ email: identifier, password, rememberMe: true })
        : await authClient.signIn.username({
            username: identifier.toLowerCase(),
            password,
            rememberMe: true,
          });
      if (result.error) {
        setError("邮箱、用户名或密码不正确，或账号已停用。");
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
    <main className="grid min-h-[100dvh] bg-[var(--color-bg-canvas)] lg:grid-cols-[minmax(380px,0.92fr)_minmax(520px,1.08fr)]">
      <aside className="relative isolate flex min-h-[180px] overflow-hidden border-b border-[#dce5ff] bg-[#eef3ff] px-6 py-6 text-[var(--color-text-primary)] sm:min-h-[220px] sm:px-10 sm:py-8 lg:min-h-[100dvh] lg:border-b-0 lg:border-r lg:px-[clamp(40px,5vw,76px)] lg:py-10">
        <div
          aria-hidden="true"
          className="absolute -right-20 top-[18%] -z-10 size-[420px] rounded-full bg-white/80 blur-[110px]"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-52 -left-32 -z-10 size-[500px] rounded-full bg-[#cbd8ff]/60 blur-[130px]"
        />

        <div className="flex w-full flex-col justify-between gap-12">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-[var(--color-accent)] text-white shadow-[0_12px_28px_-16px_rgb(38_71_168_/_0.72)]">
              <CirclesFour aria-hidden="true" size={19} weight="fill" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[-0.01em]">Data Agent</p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                Analytics workspace
              </p>
            </div>
          </div>

          <div className="hidden max-w-[520px] lg:block">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--color-accent)]">
              Governed intelligence
            </p>
            <h2 className="mt-5 text-[clamp(34px,4vw,58px)] font-semibold leading-[1.04] tracking-[-0.055em] text-[var(--color-text-primary)]">
              从可信数据，
              <br />
              到可执行答案。
            </h2>
            <p className="mt-6 max-w-md text-sm leading-7 text-[var(--color-text-secondary)]">
              在一个工作空间中完成数据连接、语义治理、分析运行与评测，让每一个结论都有边界和依据。
            </p>
          </div>

          <div className="hidden grid-cols-2 gap-3 lg:grid">
            <div className="rounded-[16px] border border-white/90 bg-white/66 p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.9)] backdrop-blur-sm">
              <Database aria-hidden="true" className="text-[var(--color-accent)]" size={18} />
              <p className="mt-5 text-xs font-medium text-[var(--color-text-primary)]">
                Evidence grounded
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
                数据、语义与运行证据可追溯
              </p>
            </div>
            <div className="rounded-[16px] border border-white/90 bg-white/66 p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.9)] backdrop-blur-sm">
              <ShieldCheck aria-hidden="true" className="text-[var(--color-accent)]" size={18} />
              <p className="mt-5 text-xs font-medium text-[var(--color-text-primary)]">
                Authority first
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
                身份、角色与环境共同约束能力
              </p>
            </div>
          </div>
        </div>
      </aside>

      <section className="flex items-center justify-center px-6 py-10 sm:px-10 sm:py-12 lg:px-[8vw]">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 flex size-11 items-center justify-center rounded-[14px] bg-[var(--color-accent-soft)] text-[var(--color-accent)] lg:hidden">
            <LockKey aria-hidden="true" size={21} weight="fill" />
          </div>
          <p className="page-eyebrow">Secure access</p>
          <h1 className="page-title">欢迎回来</h1>
          <p className="page-description">登录 Data Agent 工作台，继续你的分析与治理任务。</p>

          <form onSubmit={submit} className="mt-9 space-y-5">
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                邮箱或用户名
              </span>
              <input
                name="identifier"
                type="text"
                autoComplete="username"
                required
                className="mt-2 h-12 w-full rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-[var(--color-border-focused)] focus:shadow-[0_0_0_3px_rgb(63_99_232_/_0.12)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">密码</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-2 h-12 w-full rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-[var(--color-border-focused)] focus:shadow-[0_0_0_3px_rgb(63_99_232_/_0.12)]"
              />
            </label>
            {error && (
              <p
                role="alert"
                className="rounded-[var(--radius-control)] border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="control-pressable flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] text-sm font-semibold text-white shadow-[0_12px_26px_-16px_rgb(38_71_168_/_0.78)] hover:bg-[var(--color-accent-hover)] disabled:cursor-wait disabled:opacity-55"
            >
              <span>{pending ? "正在验证…" : "登录工作台"}</span>
              {!pending && <ArrowRight aria-hidden="true" size={16} weight="bold" />}
            </button>
          </form>

          <div className="mt-8 flex items-start gap-2.5 border-t border-[var(--color-border-default)] pt-5 text-[11px] leading-5 text-[var(--color-text-muted)]">
            <LockKey aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
            <p>账号由超级管理员创建，系统不开放自主注册。登录行为会按工作空间权限审计。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
