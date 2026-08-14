"use client";

import type {
  FxRateCandidate,
  ModelCatalogEntry,
  ModelPriceCandidate,
  ModelProvider,
} from "@data-agent/contracts";
import { useCallback, useEffect, useState } from "react";
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

  const createModel = async () => {
    setError(null);
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
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "模型创建失败");
    }
  };

  const setStatus = async (
    model: ModelCatalogEntry,
    status: "ACTIVE" | "DISABLED" | "UNBILLABLE",
  ) => {
    setError(null);
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
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "模型状态更新失败");
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
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "审批失败");
    } finally {
      setDecisionPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">模型、价格与汇率控制面</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          自动同步只创建候选；批准后才会生成不可变的生效版本。
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-[var(--color-text-muted)]">正在加载数据库权威记录…</p>}

      <section className="rounded-lg border border-[var(--color-border-default)] p-4">
        <h2 className="text-sm font-semibold">新增不可计费模型草稿</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <select
            className="rounded border p-2 text-sm"
            value={provider}
            onChange={(event) => setProvider(event.target.value as ModelProvider)}
          >
            {providers.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input
            className="rounded border p-2 text-sm"
            placeholder="模型 ID"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          />
          <input
            className="rounded border p-2 text-sm"
            placeholder="显示名称"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <input
            className="rounded border p-2 text-sm"
            placeholder="Base URL"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
        <Button
          className="mt-3"
          onClick={createModel}
          disabled={!modelId.trim() || !displayName.trim()}
        >
          创建草稿
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">模型目录</h2>
        {models.map((model) => (
          <div
            key={model.model_profile_id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-default)] p-3 text-sm"
          >
            <span className="font-medium">{model.display_name}</span>
            <span className="text-[var(--color-text-muted)]">
              {model.provider} / {model.model_id}
            </span>
            <span>
              {model.status} · v{model.config_version}
            </span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStatus(model, "ACTIVE")}>
                启用
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStatus(model, "UNBILLABLE")}>
                不可计费
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStatus(model, "DISABLED")}>
                停用
              </Button>
            </div>
          </div>
        ))}
      </section>

      <CandidateSection
        title="价格候选"
        rows={prices.map((candidate) => ({
          id: candidate.candidate_id,
          label: `${candidate.provider} / ${candidate.model_id} · ${candidate.components.length} 个维度`,
          status: candidate.status,
        }))}
        onDecide={(id, decision) => requestDecision("prices", id, decision)}
      />
      <CandidateSection
        title="汇率候选"
        rows={fxRates.map((candidate) => ({
          id: candidate.candidate_id,
          label: `${candidate.base_currency}/${candidate.quote_currency} ${candidate.rate} · ${candidate.official_date}`,
          status: candidate.status,
        }))}
        onDecide={(id, decision) => requestDecision("fx", id, decision)}
      />

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
    </div>
  );
}

function CandidateSection(props: {
  readonly title: string;
  readonly rows: readonly {
    readonly id: string;
    readonly label: string;
    readonly status: string;
  }[];
  readonly onDecide: (id: string, decision: "APPROVE" | "REJECT") => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{props.title}</h2>
      {props.rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center gap-3 rounded-lg border border-[var(--color-border-default)] p-3 text-sm"
        >
          <span>{row.label}</span>
          <span className="text-[var(--color-text-muted)]">{row.status}</span>
          {row.status === "PENDING_REVIEW" && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" onClick={() => props.onDecide(row.id, "APPROVE")}>
                批准
              </Button>
              <Button size="sm" variant="ghost" onClick={() => props.onDecide(row.id, "REJECT")}>
                拒绝
              </Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
