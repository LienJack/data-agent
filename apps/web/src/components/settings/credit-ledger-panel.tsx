"use client";

import type {
  BillingAuditEntry,
  CreditAccount,
  CreditLedgerEntry,
  CreditReconciliationReceipt,
} from "@data-agent/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface CreditLedgerPanelProps {
  readonly isSuperAdmin: boolean;
}

interface ApiFailure {
  readonly error?: { readonly message?: string };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as ApiFailure & { readonly data?: T };
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? `请求失败 (${response.status})`);
  }
  return body.data;
}

function formatMicrocredits(value: string): string {
  const negative = value.startsWith("-");
  const absolute = BigInt(negative ? value.slice(1) : value);
  const whole = absolute / 1_000_000n;
  const fraction = String(absolute % 1_000_000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "−" : ""}${whole.toLocaleString("zh-CN")}${fraction ? `.${fraction}` : ""}`;
}

function creditsToMicrocredits(value: string): string | null {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const magnitude = BigInt(match[2] ?? "0") * 1_000_000n + BigInt((match[3] ?? "").padEnd(6, "0"));
  if (magnitude === 0n) return null;
  return `${match[1] === "-" ? "-" : ""}${magnitude}`;
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function operationKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent" | "muted";
}) {
  return (
    <div className="min-w-0 px-4 py-4 first:pl-0 last:pr-0">
      <p className="text-[11px] font-medium tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-2xl font-semibold tabular-nums tracking-[-0.03em] ${
          tone === "accent" ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">credits</p>
    </div>
  );
}

function LedgerTable({ entries }: { entries: readonly CreditLedgerEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="border-t border-dashed border-[var(--color-border-default)] py-10 text-center">
        <p className="text-sm font-medium">还没有积分流水</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          管理员调账后，记录会出现在这里。
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto border-t border-[var(--color-border-default)]">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          <tr>
            <th className="py-2 pr-4 font-medium">时间 / 类型</th>
            <th className="px-4 py-2 text-right font-medium">变动</th>
            <th className="px-4 py-2 text-right font-medium">结余</th>
            <th className="px-4 py-2 font-medium">原因</th>
            <th className="py-2 pl-4 text-right font-medium">版本</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-default)]">
          {entries.map((entry) => (
            <tr key={entry.entry_id} className="group hover:bg-[var(--color-bg-canvas)]">
              <td className="py-3 pr-4">
                <p className="font-medium text-[var(--color-text-primary)]">{entry.kind}</p>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  {timestamp(entry.created_at)}
                </p>
              </td>
              <td
                className={`px-4 py-3 text-right font-semibold tabular-nums ${
                  entry.signed_microcredits.startsWith("-")
                    ? "text-[var(--color-error)]"
                    : "text-[var(--color-success)]"
                }`}
              >
                {entry.signed_microcredits.startsWith("-") ? "" : "+"}
                {formatMicrocredits(entry.signed_microcredits)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatMicrocredits(entry.balance_after_microcredits)}
              </td>
              <td className="max-w-[280px] px-4 py-3 text-[var(--color-text-secondary)]">
                <span className="line-clamp-2">{entry.reason}</span>
              </td>
              <td className="py-3 pl-4 text-right tabular-nums text-[var(--color-text-muted)]">
                v{entry.account_version}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CreditLedgerPanel({ isSuperAdmin }: CreditLedgerPanelProps) {
  const [account, setAccount] = useState<CreditAccount>();
  const [ledger, setLedger] = useState<readonly CreditLedgerEntry[]>([]);
  const [accounts, setAccounts] = useState<readonly CreditAccount[]>([]);
  const [audit, setAudit] = useState<readonly BillingAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selectedPrincipal, setSelectedPrincipal] = useState<string>();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [reconciliation, setReconciliation] = useState<CreditReconciliationReceipt>();
  const [rebuildTarget, setRebuildTarget] = useState<CreditAccount>();
  const [rebuildReason, setRebuildReason] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [ownAccount, ownLedger] = await Promise.all([
        api<CreditAccount>("/api/billing/me"),
        api<readonly CreditLedgerEntry[]>("/api/billing/me/ledger"),
      ]);
      setAccount(ownAccount);
      setLedger(ownLedger);
      if (isSuperAdmin) {
        const [globalAccounts, globalAudit] = await Promise.all([
          api<readonly CreditAccount[]>("/api/admin/credits"),
          api<readonly BillingAuditEntry[]>("/api/admin/credits/audit"),
        ]);
        setAccounts(globalAccounts);
        setAudit(globalAudit);
        setSelectedPrincipal((current) => current ?? globalAccounts[0]?.principal_id);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "积分账户加载失败");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => void reload(), [reload]);

  const selected = useMemo(
    () => accounts.find((candidate) => candidate.principal_id === selectedPrincipal),
    [accounts, selectedPrincipal],
  );

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const signedMicrocredits = creditsToMicrocredits(amount);
    if (!signedMicrocredits) {
      setError("请输入非零积分，最多保留 6 位小数。");
      return;
    }
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await api(`/api/admin/credits/${encodeURIComponent(selected.principal_id)}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "credit-adjustment@1.0.0",
          operation_id: crypto.randomUUID(),
          idempotency_key: operationKey("credit-adjust"),
          target_principal_id: selected.principal_id,
          signed_microcredits: signedMicrocredits,
          reason: reason.trim(),
          expected_account_version: selected.version,
        }),
      });
      setAmount("");
      setReason("");
      setNotice(`已完成调账：${formatMicrocredits(signedMicrocredits)} credits`);
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "积分调账失败");
    } finally {
      setPending(false);
    }
  }

  async function reconcile(principalId: string) {
    setPending(true);
    setError(undefined);
    try {
      const result = await api<CreditReconciliationReceipt>(
        `/api/admin/credits/${encodeURIComponent(principalId)}/reconcile`,
      );
      setReconciliation(result);
      setNotice(result.consistent ? "账本与账户投影一致。" : "发现投影差异，请核对后执行重建。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "积分对账失败");
    } finally {
      setPending(false);
    }
  }

  function requestProjectionRebuild(target: CreditAccount) {
    setRebuildReason("");
    setRebuildTarget(target);
  }

  async function rebuildProjection(reason: string) {
    if (!rebuildTarget) return;
    setPending(true);
    setError(undefined);
    try {
      await api(`/api/admin/credits/${encodeURIComponent(rebuildTarget.principal_id)}/rebuild`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "credit-projection-rebuild@1.0.0",
          operation_id: crypto.randomUUID(),
          idempotency_key: operationKey("credit-rebuild"),
          target_principal_id: rebuildTarget.principal_id,
          reason,
          expected_account_version: rebuildTarget.version,
        }),
      });
      setRebuildTarget(undefined);
      setRebuildReason("");
      setNotice("账户投影已按不可变账本重建。");
      setReconciliation(undefined);
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "投影重建失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="credit-ledger-heading" className="space-y-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Credit ledger
          </p>
          <h2 id="credit-ledger-heading" className="mt-1 text-lg font-semibold tracking-[-0.02em]">
            积分账户
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            全局账户、工作空间归因。所有余额都可由不可变账本重算。
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
          <span className="size-1.5 rounded-full bg-[var(--color-success)]" />
          PostgreSQL 权威
          {account && <span>· v{account.version}</span>}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"
        >
          {notice}
        </div>
      )}

      {loading || !account ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Metric
              label="可用余额"
              value={formatMicrocredits(account.available_microcredits)}
              tone="accent"
            />
            <Metric label="账户结算余额" value={formatMicrocredits(account.settled_microcredits)} />
            <Metric
              label="调用冻结"
              value={formatMicrocredits(account.active_held_microcredits)}
              tone="muted"
            />
          </div>

          <section aria-labelledby="personal-ledger-heading">
            <div className="flex items-center justify-between pb-3">
              <div>
                <h3 id="personal-ledger-heading" className="text-sm font-semibold">
                  个人流水
                </h3>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {account.principal_id}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void reload()}
                disabled={loading}
              >
                刷新
              </Button>
            </div>
            <LedgerTable entries={ledger} />
          </section>
        </>
      )}

      {isSuperAdmin && !loading && (
        <section
          aria-labelledby="global-credit-heading"
          className="border-t border-[var(--color-border-default)] pt-8"
        >
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <h3 id="global-credit-heading" className="text-sm font-semibold">
                全局账户管理
              </h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                正数增加积分，负数扣减积分；扣减不会穿透冻结额或产生负余额。
              </p>
            </div>
            <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
              {accounts.length} 个账户
            </span>
          </div>

          <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="border-y border-[var(--color-border-default)] text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-2 pr-4 font-medium">用户</th>
                    <th className="px-4 py-2 text-right font-medium">可用 / 冻结</th>
                    <th className="px-4 py-2 text-right font-medium">版本</th>
                    <th className="py-2 pl-4 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-default)]">
                  {accounts.map((candidate) => (
                    <tr
                      key={candidate.principal_id}
                      className={
                        candidate.principal_id === selectedPrincipal
                          ? "bg-[var(--color-selection-selected-bg)]"
                          : "hover:bg-[var(--color-bg-canvas)]"
                      }
                    >
                      <td className="py-3 pr-4 font-mono text-[10px]">{candidate.principal_id}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-semibold">
                          {formatMicrocredits(candidate.available_microcredits)}
                        </span>
                        <span className="text-[var(--color-text-muted)]">
                          {" "}
                          / {formatMicrocredits(candidate.active_held_microcredits)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                        v{candidate.version}
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setSelectedPrincipal(candidate.principal_id)}
                        >
                          管理
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <aside className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-4">
              <h4 className="text-xs font-semibold">人工调账</h4>
              {selected ? (
                <form className="mt-4 space-y-4" onSubmit={adjust}>
                  <div className="rounded-md bg-white px-3 py-2">
                    <p className="truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                      {selected.principal_id}
                    </p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">
                      {formatMicrocredits(selected.available_microcredits)} credits
                    </p>
                  </div>
                  <label className="block">
                    <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                      变动积分
                    </span>
                    <input
                      required
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="例如 100 或 -25"
                      inputMode="decimal"
                      className="mt-1.5 h-9 w-full rounded-md border border-[var(--color-border-default)] bg-white px-3 text-sm tabular-nums outline-none focus:border-[var(--color-border-focused)]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                      调账原因
                    </span>
                    <textarea
                      required
                      minLength={1}
                      maxLength={500}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="原因将永久写入审计记录"
                      className="mt-1.5 min-h-20 w-full resize-y rounded-md border border-[var(--color-border-default)] bg-white p-3 text-xs leading-5 outline-none focus:border-[var(--color-border-focused)]"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" loading={pending}>
                      提交调账
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void reconcile(selected.principal_id)}
                    >
                      对账
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => requestProjectionRebuild(selected)}
                    >
                      重建投影
                    </Button>
                  </div>
                  {reconciliation?.principal_id === selected.principal_id && (
                    <div
                      className={`rounded-md px-3 py-2 text-[11px] ${reconciliation.consistent ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
                    >
                      {reconciliation.consistent ? "一致" : "存在差异"} · 账本{" "}
                      {formatMicrocredits(reconciliation.ledger_settled_microcredits)} · 冻结{" "}
                      {formatMicrocredits(reconciliation.active_holds_microcredits)}
                    </div>
                  )}
                </form>
              ) : (
                <p className="mt-4 text-xs text-[var(--color-text-muted)]">暂无可管理账户。</p>
              )}
            </aside>
          </div>

          <details className="mt-6 border-t border-[var(--color-border-default)] pt-4">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-secondary)]">
              最近账务审计 · {audit.length}
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[11px]">
                <tbody className="divide-y divide-[var(--color-border-default)]">
                  {audit.slice(0, 50).map((entry) => (
                    <tr key={entry.audit_id}>
                      <td className="py-2 pr-4 font-medium">{entry.action}</td>
                      <td className="px-4 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                        {entry.target_principal_id}
                      </td>
                      <td className="max-w-[320px] px-4 py-2 text-[var(--color-text-secondary)]">
                        {entry.reason}
                      </td>
                      <td className="py-2 pl-4 text-right text-[var(--color-text-muted)]">
                        {timestamp(entry.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {rebuildTarget && (
        <ReasonDialog
          eyebrow="Rebuild projection"
          title="从不可变账本重建账户投影"
          description={`将重新计算账户 ${rebuildTarget.principal_id.slice(0, 8)}… 的余额与冻结汇总；不会修改或删除任何账本流水。`}
          reasonLabel="重建原因"
          confirmLabel="确认重建"
          destructive
          reason={rebuildReason}
          pending={pending}
          error={error}
          onReasonChange={setRebuildReason}
          onCancel={() => {
            setRebuildTarget(undefined);
            setRebuildReason("");
          }}
          onConfirm={(reason) => void rebuildProjection(reason)}
        />
      )}
    </section>
  );
}
