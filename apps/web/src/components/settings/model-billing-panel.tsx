"use client";

import type {
  BillingModeDecisionReceipt,
  BillingReconciliationReceipt,
  BillingRuntimeState,
  ModelBillingBill,
  ModelBillingCostSummary,
  ModelUsage,
} from "@data-agent/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ModelBillingPanelProps {
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

function operationKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function credits(value: string) {
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = String(amount % 1_000_000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString("zh-CN")}${fraction ? `.${fraction}` : ""}`;
}

function sumCny(values: readonly string[]): string {
  const scale = 18;
  const total = values.reduce((sum, value) => {
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
    if (!match || (match[2]?.length ?? 0) > scale) return sum;
    return sum + BigInt(`${match[1]}${(match[2] ?? "").padEnd(scale, "0")}`);
  }, 0n);
  const rounded = (total + 5n * 10n ** 13n) / 10n ** 14n;
  const whole = rounded / 10_000n;
  const fraction = String(rounded % 10_000n).padStart(4, "0");
  return `${whole}.${fraction}`;
}

function stateBadge(state: ModelBillingBill["state"]) {
  switch (state) {
    case "SETTLED":
      return <Badge variant="success">已结算</Badge>;
    case "RELEASED":
      return <Badge variant="secondary">已释放</Badge>;
    case "REVIEW_REQUIRED":
      return <Badge variant="warning">待复核</Badge>;
    case "RESERVED":
      return <Badge variant="outline">已冻结</Badge>;
  }
}

function BillsTable({ bills }: { readonly bills: readonly ModelBillingBill[] }) {
  if (bills.length === 0) {
    return (
      <div className="border-t border-dashed border-[var(--color-border-default)] py-9 text-center">
        <p className="text-sm font-medium">还没有模型账单</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          模型调用完成后，会在这里显示冻结、实际成本和归属工作空间。
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto border-t border-[var(--color-border-default)]">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          <tr>
            <th className="py-2 pr-4 font-medium">模型 / 时间</th>
            <th className="px-4 py-2 font-medium">状态</th>
            <th className="px-4 py-2 font-medium">资金</th>
            <th className="px-4 py-2 text-right font-medium">人民币成本</th>
            <th className="px-4 py-2 text-right font-medium">积分</th>
            <th className="py-2 pl-4 font-medium">工作空间 / Run</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-default)]">
          {bills.map((bill) => (
            <tr key={bill.bill_id} className="hover:bg-[var(--color-bg-canvas)]">
              <td className="py-3 pr-4">
                <p className="font-medium text-[var(--color-text-primary)]">
                  {bill.provider} / {bill.model_id}
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  {timestamp(bill.created_at)}
                </p>
              </td>
              <td className="px-4 py-3">{stateBadge(bill.state)}</td>
              <td className="px-4 py-3">
                <span className="text-[var(--color-text-secondary)]">
                  {bill.funding_type === "SYSTEM_FUNDED" ? "平台承担" : "用户积分"}
                </span>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  {bill.billing_mode}
                </p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">¥{bill.cny_cost}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {credits(bill.charged_microcredits)}
              </td>
              <td className="py-3 pl-4 font-mono text-[10px] text-[var(--color-text-muted)]">
                <p>{bill.workspace_id.slice(0, 8)}…</p>
                <p className="mt-0.5">{bill.run_id.slice(0, 8)}…</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const emptyUsage: ModelUsage = {
  input_tokens: "0",
  output_tokens: "0",
  cache_read_tokens: "0",
  cache_write_tokens: "0",
  tool_calls: "0",
};

export function ModelBillingPanel({ isSuperAdmin }: ModelBillingPanelProps) {
  const [ownBills, setOwnBills] = useState<readonly ModelBillingBill[]>([]);
  const [runtime, setRuntime] = useState<BillingRuntimeState>();
  const [reconciliation, setReconciliation] = useState<BillingReconciliationReceipt>();
  const [costs, setCosts] = useState<readonly ModelBillingCostSummary[]>([]);
  const [reviews, setReviews] = useState<readonly ModelBillingBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selectedReview, setSelectedReview] = useState<ModelBillingBill>();
  const [verifiedUsage, setVerifiedUsage] = useState<ModelUsage>(emptyUsage);
  const [reviewReason, setReviewReason] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setOwnBills(await api<readonly ModelBillingBill[]>("/api/billing/me/bills"));
      if (isSuperAdmin) {
        const [nextRuntime, nextReconciliation, nextCosts, nextReviews] = await Promise.all([
          api<BillingRuntimeState>("/api/admin/billing/state"),
          api<BillingReconciliationReceipt>("/api/admin/billing/reconciliation"),
          api<readonly ModelBillingCostSummary[]>("/api/admin/billing/costs"),
          api<readonly ModelBillingBill[]>("/api/admin/billing/bills?state=REVIEW_REQUIRED"),
        ]);
        setRuntime(nextRuntime);
        setReconciliation(nextReconciliation);
        setCosts(nextCosts);
        setReviews(nextReviews);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "模型计费加载失败");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => void reload(), [reload]);

  const totalCost = useMemo(() => sumCny(costs.map((row) => row.cny_cost)), [costs]);

  async function decideMode() {
    if (!runtime) return;
    const target = runtime.mode === "SHADOW" ? "ENFORCED" : "SHADOW";
    const reason = window.prompt(
      target === "ENFORCED"
        ? "请输入启用强制计费的审批原因。仅在 Shadow 对账通过后生效。"
        : "请输入退回 Shadow 的原因。历史账单不会删除。",
    );
    if (!reason?.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const receipt = await api<BillingModeDecisionReceipt>("/api/admin/billing/state", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "billing-mode-decision@1.0.0",
          operation_id: crypto.randomUUID(),
          idempotency_key: operationKey("billing-mode"),
          target_mode: target,
          expected_epoch: runtime.epoch,
          reason: reason.trim(),
        }),
      });
      setRuntime(receipt.state);
      setReconciliation(receipt.reconciliation);
      setNotice(`计费模式已切换为 ${receipt.state.mode}。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "计费模式切换失败");
    } finally {
      setPending(false);
    }
  }

  async function releaseReview(bill: ModelBillingBill) {
    const reason = window.prompt("请输入释放冻结的复核依据。此操作会写入不可变审计记录。");
    if (!reason?.trim()) return;
    await submitReview(bill, "RELEASE", null, reason.trim());
  }

  async function submitReview(
    bill: ModelBillingBill,
    decision: "SETTLE_VERIFIED" | "RELEASE",
    usage: ModelUsage | null,
    reason: string,
  ) {
    setPending(true);
    setError(undefined);
    try {
      await api(`/api/admin/billing/reviews/${encodeURIComponent(bill.bill_id)}`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "model-billing-review@1.0.0",
          operation_id: crypto.randomUUID(),
          idempotency_key: operationKey("billing-review"),
          bill_id: bill.bill_id,
          decision,
          verified_usage: usage,
          reason,
        }),
      });
      setNotice(decision === "RELEASE" ? "冻结已按复核依据释放。" : "账单已按核实用量结算。");
      setSelectedReview(undefined);
      setReviewReason("");
      setVerifiedUsage(emptyUsage);
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "账单复核失败");
    } finally {
      setPending(false);
    }
  }

  function settleVerified(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReview || !reviewReason.trim()) return;
    void submitReview(selectedReview, "SETTLE_VERIFIED", verifiedUsage, reviewReason.trim());
  }

  return (
    <section aria-labelledby="model-billing-heading" className="space-y-7">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Model billing
          </p>
          <h2 id="model-billing-heading" className="mt-1 text-lg font-semibold tracking-[-0.02em]">
            模型账单与成本归因
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            调用前冻结上限，终止后按不可变用量结算；工作空间成本与用户积分分开记录。
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={() => void reload()} disabled={loading}>
          刷新
        </Button>
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

      {loading ? <Skeleton className="h-28 w-full" /> : <BillsTable bills={ownBills} />}

      {isSuperAdmin && !loading && runtime && reconciliation && (
        <div className="border-t border-[var(--color-border-default)] pt-8">
          <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr_1fr]">
            <div className="rounded-lg border border-[var(--color-border-default)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
                    Deployment mode
                  </p>
                  <p className="mt-2 text-xl font-semibold tracking-[-0.03em]">{runtime.mode}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    部署级 · epoch {runtime.epoch}
                  </p>
                </div>
                <Badge variant={runtime.mode === "ENFORCED" ? "success" : "warning"}>
                  {runtime.mode === "ENFORCED" ? "强制扣费" : "影子计费"}
                </Badge>
              </div>
              <Button className="mt-5" loading={pending} onClick={() => void decideMode()}>
                {runtime.mode === "SHADOW" ? "审批启用 Enforced" : "退回 Shadow"}
              </Button>
            </div>

            <div className="rounded-lg border border-[var(--color-border-default)] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
                  Reconciliation
                </p>
                <Badge variant={reconciliation.ready_for_enforced ? "success" : "warning"}>
                  {reconciliation.ready_for_enforced ? "可启用" : "需处理"}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xl font-semibold tabular-nums">
                    {reconciliation.missing_bills}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">遗漏</p>
                </div>
                <div>
                  <p className="text-xl font-semibold tabular-nums">
                    {reconciliation.open_review_findings}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">复核</p>
                </div>
                <div>
                  <p className="text-xl font-semibold tabular-nums">
                    {reconciliation.hold_ledger_mismatches}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">账实差异</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-border-default)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
                Attributed cost
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums tracking-[-0.03em]">
                ¥{totalCost}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {costs.length} 个 workspace / run 归因分组
              </p>
              <p className="mt-4 text-[10px] text-[var(--color-text-muted)]">
                包含用户积分与 SYSTEM_FUNDED 外部成本。
              </p>
            </div>
          </div>

          <section className="mt-7" aria-labelledby="billing-review-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 id="billing-review-heading" className="text-sm font-semibold">
                  人工复核队列
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  费用不确定时保留冻结；管理员只能按核实用量结算或明确释放。
                </p>
              </div>
              <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                {reviews.length} 条
              </span>
            </div>
            {reviews.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-[var(--color-border-default)] px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">
                当前没有待复核账单
              </div>
            ) : (
              <div className="mt-3 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
                {reviews.map((bill) => (
                  <div key={bill.bill_id} className="py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {stateBadge(bill.state)}
                      <span className="text-xs font-medium">
                        {bill.provider} / {bill.model_id}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {bill.review_reason}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <Button variant="ghost" onClick={() => setSelectedReview(bill)}>
                          核实用量
                        </Button>
                        <Button loading={pending} onClick={() => void releaseReview(bill)}>
                          释放
                        </Button>
                      </div>
                    </div>
                    {selectedReview?.bill_id === bill.bill_id && (
                      <form
                        onSubmit={settleVerified}
                        className="mt-3 rounded-lg bg-[var(--color-bg-canvas)] p-3"
                      >
                        <div className="grid gap-2 sm:grid-cols-5">
                          {(Object.keys(emptyUsage) as readonly (keyof ModelUsage)[]).map((key) => (
                            <label key={key} className="text-[10px] text-[var(--color-text-muted)]">
                              {key}
                              <input
                                className="mt-1 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs"
                                inputMode="numeric"
                                pattern="[0-9]+"
                                value={verifiedUsage[key]}
                                onChange={(event) =>
                                  setVerifiedUsage((current) => ({
                                    ...current,
                                    [key]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <input
                          className="mt-2 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs"
                          placeholder="复核依据（必填）"
                          value={reviewReason}
                          onChange={(event) => setReviewReason(event.target.value)}
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setSelectedReview(undefined)}
                          >
                            取消
                          </Button>
                          <Button type="submit" loading={pending} disabled={!reviewReason.trim()}>
                            按核实用量结算
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
