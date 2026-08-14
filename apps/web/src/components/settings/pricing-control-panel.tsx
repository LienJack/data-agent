"use client";

import type {
  FxRateCandidate,
  ModelCatalogEntry,
  ModelPriceCandidate,
  ModelProvider,
} from "@data-agent/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";

const providers: readonly ModelProvider[] = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "grok",
  "kimi",
  "glm",
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? `请求失败 (${response.status})`);
  }
  return body.data;
}

function operationKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

interface PricingDecisionRequest {
  readonly kind: "prices" | "fx";
  readonly candidateId: string;
  readonly decision: "APPROVE" | "REJECT";
}

function modelStatusLabel(status: ModelCatalogEntry["status"]) {
  switch (status) {
    case "DRAFT":
      return { label: "草稿", className: "border-sky-200 bg-sky-50 text-sky-700" };
    case "ACTIVE":
      return { label: "已启用", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    case "UNBILLABLE":
      return { label: "不可计费", className: "border-amber-200 bg-amber-50 text-amber-700" };
    case "DISABLED":
      return { label: "已停用", className: "border-slate-200 bg-slate-100 text-slate-600" };
  }
}

function candidateStatusLabel(status: string) {
  if (status === "PENDING_REVIEW") {
    return { label: "待审批", className: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  if (status === "APPROVED") {
    return { label: "已批准", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  return { label: "已拒绝", className: "border-slate-200 bg-slate-100 text-slate-600" };
}

export function PricingControlPanel() {
  const [models, setModels] = useState<readonly ModelCatalogEntry[]>([]);
  const [prices, setPrices] = useState<readonly ModelPriceCandidate[]>([]);
  const [fxRates, setFxRates] = useState<readonly FxRateCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ModelProvider>("openai");
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [decisionRequest, setDecisionRequest] = useState<PricingDecisionRequest>();
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionPending, setDecisionPending] = useState(false);
  const [actionPending, setActionPending] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextModels, nextPrices, nextFx] = await Promise.all([
        api<readonly ModelCatalogEntry[]>("/api/admin/models"),
        api<readonly ModelPriceCandidate[]>("/api/admin/prices"),
        api<readonly FxRateCandidate[]>("/api/admin/fx"),
      ]);
      setModels(nextModels);
      setPrices(nextPrices);
      setFxRates(nextFx);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "控制面加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void reload(), [reload]);

  const createModel = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(undefined);
    setActionPending("create-model");
    try {
      await api<ModelCatalogEntry>("/api/admin/models", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "model-catalog-upsert@1.0.0",
          operation_id: crypto.randomUUID(),
          idempotency_key: operationKey("model-create"),
          model_profile_id: crypto.randomUUID(),
          provider,
          model_id: modelId.trim(),
          display_name: displayName.trim(),
          base_url: baseUrl.trim(),
          capabilities: {
            structured_output: true,
            tool_calling: true,
            streaming: true,
            reasoning: true,
            vision: false,
          },
          credential_ref: null,
          status: "UNBILLABLE",
          is_system_default: false,
          expected_config_version: 0,
        }),
      });
      setModelId("");
      setDisplayName("");
      setNotice("不可计费模型草稿已创建；配置价格并完成审批前不会进入计费路径。");
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "模型创建失败");
    } finally {
      setActionPending(undefined);
    }
  };

  const setStatus = async (
    model: ModelCatalogEntry,
    status: "ACTIVE" | "DISABLED" | "UNBILLABLE",
  ) => {
    setError(null);
    setNotice(undefined);
    setActionPending(`${model.model_profile_id}:${status}`);
    try {
      await api<ModelCatalogEntry>(
        `/api/admin/models/${encodeURIComponent(model.model_profile_id)}/status`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "model-catalog-status@1.0.0",
            operation_id: crypto.randomUUID(),
            idempotency_key: operationKey("model-status"),
            model_profile_id: model.model_profile_id,
            status,
            expected_config_version: model.config_version,
          }),
        },
      );
      setNotice(`模型状态已更新为 ${status}。`);
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "模型状态更新失败");
    } finally {
      setActionPending(undefined);
    }
  };

  const requestDecision = (
    kind: "prices" | "fx",
    candidateId: string,
    decision: "APPROVE" | "REJECT",
  ) => {
    setDecisionReason("");
    setDecisionRequest({ kind, candidateId, decision });
  };

  const confirmDecision = async (reason: string) => {
    if (!decisionRequest) return;
    setError(null);
    setNotice(undefined);
    setDecisionPending(true);
    try {
      await api(
        `/api/admin/${decisionRequest.kind}/${encodeURIComponent(decisionRequest.candidateId)}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "pricing-candidate-decision@1.0.0",
            operation_id: crypto.randomUUID(),
            idempotency_key: operationKey(`${decisionRequest.kind}-decision`),
            candidate_id: decisionRequest.candidateId,
            decision: decisionRequest.decision,
            reason,
            effective_from:
              decisionRequest.decision === "APPROVE" ? new Date().toISOString() : null,
          }),
        },
      );
      setDecisionRequest(undefined);
      setDecisionReason("");
      setNotice(
        decisionRequest.decision === "APPROVE"
          ? "候选已批准并生成新的生效版本。"
          : "候选已拒绝，现有生效版本保持不变。",
      );
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "审批失败");
    } finally {
      setDecisionPending(false);
    }
  };

  return (
    <section aria-labelledby="pricing-control-heading" className="space-y-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Pricing control
          </p>
          <h2
            id="pricing-control-heading"
            className="mt-1 text-lg font-semibold tracking-[-0.02em]"
          >
            模型、价格与汇率
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            自动同步只创建候选；只有超级管理员批准后，才生成不可变的生效版本。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void reload()}
          disabled={loading || !!actionPending || decisionPending}
        >
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

      {loading && models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border-default)] py-12 text-center text-sm text-[var(--color-text-muted)]">
          正在读取模型、价格与汇率权威记录…
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-[var(--color-border-default)]">
            <div className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-3">
              <h3 className="text-sm font-semibold">新增不可计费模型草稿</h3>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                草稿不包含明文密钥，也不会在价格审批完成前参与计费。
              </p>
            </div>
            <form onSubmit={createModel} className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-[11px] font-medium">
                Provider
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as ModelProvider)}
                  className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 text-xs outline-none focus:border-[var(--color-border-focused)]"
                >
                  {providers.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-medium">
                模型 ID
                <input
                  required
                  maxLength={128}
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 font-mono text-xs outline-none focus:border-[var(--color-border-focused)]"
                  placeholder="gpt-5"
                />
              </label>
              <label className="text-[11px] font-medium">
                显示名称
                <input
                  required
                  maxLength={128}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 text-xs outline-none focus:border-[var(--color-border-focused)]"
                  placeholder="GPT-5"
                />
              </label>
              <label className="text-[11px] font-medium">
                Base URL
                <input
                  required
                  type="url"
                  maxLength={512}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="mt-1.5 h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 font-mono text-xs outline-none focus:border-[var(--color-border-focused)]"
                  placeholder="https://api.example.com/v1"
                />
              </label>
              <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border-default)] pt-4 sm:col-span-2 xl:col-span-4">
                <p className="text-[10px] leading-5 text-[var(--color-text-muted)]">
                  创建后可单独启用、停用或保持不可计费状态。
                </p>
                <Button
                  type="submit"
                  loading={actionPending === "create-model"}
                  disabled={!modelId.trim() || !displayName.trim() || !baseUrl.trim()}
                >
                  创建草稿
                </Button>
              </div>
            </form>
          </section>

          <section aria-labelledby="model-catalog-heading">
            <div className="flex items-end justify-between gap-3 pb-3">
              <div>
                <h3 id="model-catalog-heading" className="text-sm font-semibold">
                  模型目录
                </h3>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  状态与配置版本由数据库权威维护
                </p>
              </div>
              <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                {models.length} 个模型
              </span>
            </div>
            {models.length === 0 ? (
              <div className="border-y border-dashed border-[var(--color-border-default)] py-8 text-center text-xs text-[var(--color-text-muted)]">
                暂无模型配置
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
                {models.map((model) => {
                  const status = modelStatusLabel(model.status);
                  const busy = actionPending?.startsWith(`${model.model_profile_id}:`) ?? false;
                  return (
                    <article
                      key={model.model_profile_id}
                      className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-xs font-semibold">{model.display_name}</h4>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${status.className}`}
                          >
                            {status.label}
                          </span>
                        </div>
                        <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-text-muted)]">
                          {model.provider} / {model.model_id} · config v{model.config_version}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1 sm:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          loading={actionPending === `${model.model_profile_id}:ACTIVE`}
                          disabled={busy || model.status === "ACTIVE"}
                          onClick={() => void setStatus(model, "ACTIVE")}
                        >
                          启用
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          loading={actionPending === `${model.model_profile_id}:UNBILLABLE`}
                          disabled={busy || model.status === "UNBILLABLE"}
                          onClick={() => void setStatus(model, "UNBILLABLE")}
                        >
                          不可计费
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-red-700 hover:bg-red-50 hover:text-red-800"
                          loading={actionPending === `${model.model_profile_id}:DISABLED`}
                          disabled={busy || model.status === "DISABLED"}
                          onClick={() => void setStatus(model, "DISABLED")}
                        >
                          停用
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <div className="grid gap-8 border-t border-[var(--color-border-default)] pt-8 xl:grid-cols-2">
            <CandidateSection
              eyebrow="Price candidates"
              title="价格候选"
              description="模型输入、输出与缓存维度的待审核价格。"
              emptyMessage="当前没有价格候选"
              rows={prices.map((candidate) => ({
                id: candidate.candidate_id,
                label: `${candidate.provider} / ${candidate.model_id}`,
                detail: `${candidate.components.length} 个计价维度`,
                status: candidate.status,
              }))}
              pending={decisionPending}
              onDecide={(id, decision) => requestDecision("prices", id, decision)}
            />
            <CandidateSection
              eyebrow="FX candidates"
              title="汇率候选"
              description="非人民币官方价格换算所需的版本化汇率。"
              emptyMessage="当前没有汇率候选"
              rows={fxRates.map((candidate) => ({
                id: candidate.candidate_id,
                label: `${candidate.base_currency}/${candidate.quote_currency} · ${candidate.rate}`,
                detail: candidate.official_date,
                status: candidate.status,
              }))}
              pending={decisionPending}
              onDecide={(id, decision) => requestDecision("fx", id, decision)}
            />
          </div>
        </>
      )}

      {decisionRequest && (
        <ReasonDialog
          eyebrow={decisionRequest.kind === "prices" ? "Price review" : "FX review"}
          title={`${decisionRequest.decision === "APPROVE" ? "批准" : "拒绝"}${decisionRequest.kind === "prices" ? "价格" : "汇率"}候选`}
          description={
            decisionRequest.decision === "APPROVE"
              ? "批准后会生成不可变的生效版本；已有账单仍绑定其原始价格与汇率快照。"
              : "拒绝只关闭当前候选，不会改变现有生效版本或历史账单。"
          }
          reasonLabel={decisionRequest.decision === "APPROVE" ? "批准原因" : "拒绝原因"}
          confirmLabel={decisionRequest.decision === "APPROVE" ? "确认批准" : "确认拒绝"}
          destructive={decisionRequest.decision === "REJECT"}
          reason={decisionReason}
          pending={decisionPending}
          error={error ?? undefined}
          onReasonChange={setDecisionReason}
          onCancel={() => {
            setDecisionRequest(undefined);
            setDecisionReason("");
          }}
          onConfirm={(reason) => void confirmDecision(reason)}
        />
      )}
    </section>
  );
}

function CandidateSection(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly emptyMessage: string;
  readonly rows: readonly {
    readonly id: string;
    readonly label: string;
    readonly detail: string;
    readonly status: string;
  }[];
  readonly pending: boolean;
  readonly onDecide: (id: string, decision: "APPROVE" | "REJECT") => void;
}) {
  return (
    <section>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-accent)]">
        {props.eyebrow}
      </p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{props.title}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{props.description}</p>
        </div>
        <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
          {props.rows.length} 条
        </span>
      </div>
      {props.rows.length === 0 ? (
        <div className="mt-3 border-y border-dashed border-[var(--color-border-default)] py-8 text-center text-xs text-[var(--color-text-muted)]">
          {props.emptyMessage}
        </div>
      ) : (
        <div className="mt-3 divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
          {props.rows.map((row) => {
            const status = candidateStatusLabel(row.status);
            return (
              <article
                key={row.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="break-all text-xs font-semibold">{row.label}</h4>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{row.detail}</p>
                </div>
                {row.status === "PENDING_REVIEW" && (
                  <div className="flex gap-2 sm:justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={props.pending}
                      onClick={() => props.onDecide(row.id, "APPROVE")}
                    >
                      批准
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={props.pending}
                      onClick={() => props.onDecide(row.id, "REJECT")}
                    >
                      拒绝
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
