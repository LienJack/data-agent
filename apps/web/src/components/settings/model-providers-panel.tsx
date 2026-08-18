"use client";

import type {
  ModelCatalogEntry,
  ModelCertificationPublicView,
  ModelProvider,
  ModelVendorId,
} from "@data-agent/contracts";
import {
  ArrowsClockwise,
  CaretDown,
  CheckCircle,
  Cpu,
  FloppyDisk,
  LockKey,
  PencilSimple,
  Plus,
  ShieldCheck,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getModelProviderCatalogItem,
  ORDERED_MODEL_PROVIDER_CATALOG,
} from "@/lib/model-provider-catalog";
import type {
  DiscoveredProviderModelView,
  ModelProviderView,
  ProviderModelView,
} from "@/lib/model-provider-view";
import { cn } from "@/lib/utils";
import { ModelCertificationDialog } from "./model-certification-dialog";
import { ProviderMark } from "./provider-mark";

interface ModelProvidersPanelProps {
  readonly isSuperAdmin: boolean;
}

interface ProviderDraft {
  readonly provider_connection_id: string;
  vendor_id: ModelVendorId;
  runtime_provider: ModelProvider;
  display_name: string;
  base_url: string;
  expected_config_version: number;
}

interface ApiError {
  readonly code?: string;
  readonly message?: string;
  readonly credential_locator?: string;
}

const CONSERVATIVE_CAPABILITIES: ModelCatalogEntry["capabilities"] = Object.freeze({
  structured_output: false,
  tool_calling: false,
  streaming: true,
  reasoning: false,
  vision: false,
});

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: ApiError;
  };
  if (!response.ok) {
    const locator = payload.error?.credential_locator;
    throw new Error(
      `${payload.error?.message ?? "请求失败"}${locator ? `（服务端注入变量：${locator}）` : ""}`,
    );
  }
  return payload.data as T;
}

function newDraft(vendorId: ModelVendorId = "deepseek"): ProviderDraft {
  const provider = getModelProviderCatalogItem(vendorId);
  return {
    provider_connection_id: crypto.randomUUID(),
    vendor_id: provider.id,
    runtime_provider: provider.runtimeProvider,
    display_name: `${provider.label} API`,
    base_url: provider.defaultBaseUrl,
    expected_config_version: 0,
  };
}

function statusLabel(provider: ModelProviderView): string {
  if (provider.source === "environment") return ".env 托管";
  if (provider.credential_state === "missing") return "待注入凭据";
  if (provider.health === "connected") return "连接正常";
  if (provider.health === "failed") return "连接异常";
  return "待验证";
}

function modelStatus(model: ProviderModelView): { label: string; className: string } {
  if (model.status === "ACTIVE") {
    return { label: "运行中", className: "bg-emerald-50 text-emerald-700" };
  }
  if (model.status === "UNBILLABLE") {
    return { label: "待计费链", className: "bg-amber-50 text-amber-700" };
  }
  return {
    label: "未启动",
    className: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]",
  };
}

function certificationStatus(view: ModelCertificationPublicView | undefined) {
  if (!view || view.state === "NOT_CERTIFIED") {
    return {
      label: "待认证",
      className: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]",
    };
  }
  if (view.state === "PASS") {
    return { label: "已认证", className: "bg-emerald-50 text-emerald-700" };
  }
  return {
    label: "待认证",
    className: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]",
  };
}

function mergeModelDirectory(
  provider: ModelProviderView,
  discovered: readonly DiscoveredProviderModelView[],
): readonly DiscoveredProviderModelView[] {
  const merged = new Map(
    provider.models.map((model) => [
      model.model_id,
      { id: model.model_id, display_name: model.display_name },
    ]),
  );
  for (const model of discovered) merged.set(model.id, model);
  return [...merged.values()].sort((left, right) =>
    left.id.localeCompare(right.id, "en", { numeric: true }),
  );
}

export function ModelProvidersPanel({ isSuperAdmin }: ModelProvidersPanelProps) {
  const [providers, setProviders] = useState<readonly ModelProviderView[]>([]);
  const [certifications, setCertifications] = useState<readonly ModelCertificationPublicView[]>([]);
  const [loading, setLoading] = useState(isSuperAdmin);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<ProviderDraft>();
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [discovering, setDiscovering] = useState<string>();
  const [directories, setDirectories] = useState<
    Readonly<Record<string, readonly DiscoveredProviderModelView[]>>
  >({});
  const [selections, setSelections] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [deleting, setDeleting] = useState<string>();
  const [certifying, setCertifying] = useState<ProviderModelView>();
  const [certificationPending, setCertificationPending] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    setError(undefined);
    try {
      const [next, nextCertifications] = await Promise.all([
        api<readonly ModelProviderView[]>("/api/admin/model-providers"),
        api<readonly ModelCertificationPublicView[]>("/api/admin/model-certifications"),
      ]);
      setProviders(next);
      setCertifications(nextCertifications);
      setSelections(
        Object.fromEntries(
          next.map((provider) => [
            provider.provider_connection_id,
            provider.models
              .filter((model) => model.status === "ACTIVE" || model.status === "UNBILLABLE")
              .map((model) => model.model_id),
          ]),
        ),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载供应商失败");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  const refreshCertifications = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      setCertifications(
        await api<readonly ModelCertificationPublicView[]>("/api/admin/model-certifications"),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载认证状态失败");
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const certificationByProfile = useMemo(
    () => new Map(certifications.map((view) => [view.model_profile_id, view])),
    [certifications],
  );

  const activeModelCount = useMemo(
    () =>
      providers.reduce(
        (count, provider) =>
          count + provider.models.filter((model) => model.status === "ACTIVE").length,
        0,
      ),
    [providers],
  );

  const saveProvider = useCallback(async () => {
    if (!draft?.display_name.trim() || !draft.base_url.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      const command = {
        schema_version: "model-provider-upsert@1.0.0" as const,
        operation_id: crypto.randomUUID(),
        idempotency_key: `provider-${crypto.randomUUID()}`,
        provider_connection_id: draft.provider_connection_id,
        vendor_id: draft.vendor_id,
        runtime_provider: draft.runtime_provider,
        display_name: draft.display_name.trim(),
        base_url: draft.base_url.trim().replace(/\/+$/, ""),
        credential_ref: null,
        expected_config_version: draft.expected_config_version,
      };
      const editing = draft.expected_config_version > 0;
      await api(
        editing
          ? `/api/admin/model-providers/${draft.provider_connection_id}`
          : "/api/admin/model-providers",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        },
      );
      setDraft(undefined);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存供应商失败");
    } finally {
      setSaving(false);
    }
  }, [draft, refresh]);

  const discoverModels = useCallback(async (provider: ModelProviderView) => {
    setDiscovering(provider.provider_connection_id);
    setError(undefined);
    try {
      const models = await api<readonly DiscoveredProviderModelView[]>(
        `/api/admin/model-providers/${provider.provider_connection_id}/models`,
        { method: "POST" },
      );
      setDirectories((current) => ({
        ...current,
        [provider.provider_connection_id]: mergeModelDirectory(provider, models),
      }));
      setExpanded(provider.provider_connection_id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "获取模型目录失败");
    } finally {
      setDiscovering(undefined);
    }
  }, []);

  const toggleModel = useCallback((connectionId: string, modelId: string) => {
    setSelections((current) => {
      const selected = current[connectionId] ?? [];
      return {
        ...current,
        [connectionId]: selected.includes(modelId)
          ? selected.filter((candidate) => candidate !== modelId)
          : [...selected, modelId],
      };
    });
  }, []);

  const saveModels = useCallback(
    async (provider: ModelProviderView) => {
      const directory =
        directories[provider.provider_connection_id] ??
        provider.models.map((model) => ({
          id: model.model_id,
          display_name: model.display_name,
        }));
      if (directory.length === 0) return;
      setSaving(true);
      setError(undefined);
      try {
        const selected = new Set(selections[provider.provider_connection_id] ?? []);
        await api(`/api/admin/model-providers/${provider.provider_connection_id}/models`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "model-provider-selection@1.0.0",
            operation_id: crypto.randomUUID(),
            idempotency_key: `selection-${crypto.randomUUID()}`,
            provider_connection_id: provider.provider_connection_id,
            expected_connection_version: provider.config_version,
            models: directory.map((model) => {
              const existing = provider.models.find((candidate) => candidate.model_id === model.id);
              return {
                model_profile_id: existing?.model_profile_id ?? crypto.randomUUID(),
                model_id: model.id,
                display_name: model.display_name,
                capabilities: existing?.capabilities ?? CONSERVATIVE_CAPABILITIES,
                enabled: selected.has(model.id),
                expected_config_version: existing?.config_version ?? 0,
              };
            }),
          }),
        });
        await refresh();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "保存模型启动状态失败");
      } finally {
        setSaving(false);
      }
    },
    [directories, refresh, selections],
  );

  const archiveProvider = useCallback(
    async (provider: ModelProviderView) => {
      setSaving(true);
      setError(undefined);
      try {
        await api(`/api/admin/model-providers/${provider.provider_connection_id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "model-provider-archive@1.0.0",
            operation_id: crypto.randomUUID(),
            idempotency_key: `archive-${crypto.randomUUID()}`,
            provider_connection_id: provider.provider_connection_id,
            expected_config_version: provider.config_version,
            reason: "管理员从平台设置归档供应商连接",
          }),
        });
        setDeleting(undefined);
        await refresh();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "删除供应商失败");
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const submitCertification = useCallback(async () => {
    if (!certifying) return;
    setCertificationPending(true);
    setError(undefined);
    try {
      await api(
        `/api/admin/models/${encodeURIComponent(certifying.model_profile_id)}/certifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "model-certification-start@1.0.0",
            model_profile_id: certifying.model_profile_id,
            expected_config_version: certifying.config_version,
            idempotency_key: `model-certification-${crypto.randomUUID()}`,
          }),
        },
      );
      setCertifying(undefined);
      await refreshCertifications();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "模型认证提交失败");
    } finally {
      setCertificationPending(false);
    }
  }, [certifying, refreshCertifications]);

  if (!isSuperAdmin) {
    return (
      <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-5">
        <div className="flex items-start gap-3">
          <LockKey size={20} className="mt-0.5 text-[var(--color-text-muted)]" />
          <div>
            <h2 className="text-sm font-semibold">模型供应商由平台管理员维护</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
              当前账户可使用已启动模型，但不能新增、编辑或删除供应商连接。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">模型供应商</h2>
            <span className="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
              {providers.length} 个供应商
            </span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              {activeModelCount} 个运行中模型
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            一个 API 供应商连接可以获取多个模型。选择需要启动的模型后，平台会继续校验凭据与计费链。
          </p>
        </div>
        <Button size="md" onClick={() => setDraft(newDraft())}>
          <Plus size={15} weight="bold" />
          新增供应商
        </Button>
      </div>

      <div className="flex items-start gap-2 border-l-2 border-[var(--color-accent)] bg-[var(--color-bg-tertiary)] px-3 py-2.5 text-xs leading-5 text-[var(--color-text-secondary)]">
        <LockKey size={16} className="mt-0.5 shrink-0" />
        <p>
          `.env` 投影的 DeepSeek、Kimi、GLM 连接始终只读；手工连接不接收明文 API Key，凭据由服务端
          Secret Authority 注入。
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
          <WarningCircle size={16} className="mt-0.5 shrink-0" weight="fill" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" aria-label="关闭错误" onClick={() => setError(undefined)}>
            <X size={15} />
          </button>
        </div>
      )}

      {draft && (
        <section className="border border-[var(--color-border-focused)] bg-[var(--color-bg-primary)] shadow-[0_12px_32px_rgb(23_26_24_/_0.08)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">
                {draft.expected_config_version > 0 ? "编辑供应商" : "新增 API 供应商"}
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                保存连接元数据后，由服务端注入对应 SecretRef 凭据。
              </p>
            </div>
            <button type="button" aria-label="关闭" onClick={() => setDraft(undefined)}>
              <X size={18} />
            </button>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium">供应商</span>
              <select
                value={draft.vendor_id}
                disabled={draft.expected_config_version > 0}
                onChange={(event) => {
                  const vendor = getModelProviderCatalogItem(event.target.value as ModelVendorId);
                  setDraft({
                    ...draft,
                    vendor_id: vendor.id,
                    runtime_provider: vendor.runtimeProvider,
                    display_name: `${vendor.label} API`,
                    base_url: vendor.defaultBaseUrl,
                  });
                }}
                className="w-full border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm focus:border-[var(--color-border-focused)] focus:outline-none disabled:bg-[var(--color-bg-tertiary)]"
              >
                {ORDERED_MODEL_PROVIDER_CATALOG.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label} · {provider.connectionLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium">连接名称</span>
              <input
                value={draft.display_name}
                onChange={(event) => setDraft({ ...draft, display_name: event.target.value })}
                className="w-full border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm focus:border-[var(--color-border-focused)] focus:outline-none"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-medium">Base URL</span>
              <input
                type="url"
                value={draft.base_url}
                onChange={(event) => setDraft({ ...draft, base_url: event.target.value })}
                placeholder="https://api.example.com/v1"
                className="w-full border border-[var(--color-border-default)] bg-white px-3 py-2 font-mono text-xs focus:border-[var(--color-border-focused)] focus:outline-none"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-3">
            <Button variant="ghost" size="md" onClick={() => setDraft(undefined)}>
              取消
            </Button>
            <Button
              size="md"
              loading={saving}
              disabled={!draft.display_name.trim() || !draft.base_url.trim()}
              onClick={saveProvider}
            >
              <FloppyDisk size={15} />
              保存连接
            </Button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-44 animate-pulse border border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)]"
            />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border-default)] p-8 text-center">
          <Cpu size={26} className="mx-auto text-[var(--color-text-muted)]" />
          <p className="mt-3 text-sm font-medium">还没有模型供应商</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            新增供应商连接后获取模型目录，并选择需要启动的模型。
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {providers.map((provider) => {
            const catalog = getModelProviderCatalogItem(provider.vendor_id);
            const isExpanded = expanded === provider.provider_connection_id;
            const directory =
              directories[provider.provider_connection_id] ??
              provider.models.map((model) => ({
                id: model.model_id,
                display_name: model.display_name,
              }));
            const selected = new Set(selections[provider.provider_connection_id] ?? []);
            return (
              <article
                key={provider.provider_connection_id}
                className="border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] shadow-[0_2px_8px_rgb(23_26_24_/_0.04)]"
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <ProviderMark vendorId={provider.vendor_id} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{provider.display_name}</h3>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[9px] font-medium",
                            provider.source === "environment"
                              ? "bg-blue-50 text-blue-700"
                              : provider.credential_state === "missing"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-emerald-50 text-emerald-700",
                          )}
                        >
                          {statusLabel(provider)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                        {catalog.label} · {catalog.connectionLabel} · {provider.models.length}{" "}
                        个已保存模型
                      </p>
                    </div>
                    {provider.immutable ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                        <LockKey size={13} /> 只读
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          aria-label={`编辑 ${provider.display_name}`}
                          onClick={() =>
                            setDraft({
                              provider_connection_id: provider.provider_connection_id,
                              vendor_id: provider.vendor_id,
                              runtime_provider: provider.runtime_provider,
                              display_name: provider.display_name,
                              base_url: provider.base_url,
                              expected_config_version: provider.config_version,
                            })
                          }
                        >
                          <PencilSimple size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`删除 ${provider.display_name}`}
                          onClick={() => setDeleting(provider.provider_connection_id)}
                        >
                          <Trash size={14} />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 border-t border-[var(--color-border-default)] pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[10px] text-[var(--color-text-secondary)]">
                          {provider.base_url}
                        </p>
                        <p className="mt-1 truncate text-[10px] text-[var(--color-text-muted)]">
                          {provider.source === "environment"
                            ? "凭据来自服务端环境变量，不会在页面返回"
                            : provider.credential_locator}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        loading={discovering === provider.provider_connection_id}
                        onClick={() => discoverModels(provider)}
                      >
                        <ArrowsClockwise size={14} />
                        获取模型
                      </Button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpanded(isExpanded ? undefined : provider.provider_connection_id)
                  }
                  className="flex w-full items-center justify-between border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-2.5 text-xs font-medium hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
                >
                  <span>模型目录与启动状态</span>
                  <CaretDown
                    size={14}
                    className={cn("transition-transform", isExpanded && "rotate-180")}
                  />
                </button>

                {isExpanded && (
                  <div className="border-t border-[var(--color-border-default)]">
                    {directory.length === 0 ? (
                      <div className="px-4 py-5 text-center text-xs text-[var(--color-text-muted)]">
                        点击“获取模型”读取供应商目录。
                      </div>
                    ) : (
                      <div className="max-h-72 overflow-y-auto">
                        {directory.map((model, index) => {
                          const saved = provider.models.find(
                            (candidate) => candidate.model_id === model.id,
                          );
                          const status = saved ? modelStatus(saved) : null;
                          const certification = saved
                            ? certificationByProfile.get(saved.model_profile_id)
                            : undefined;
                          const certificationBadge = certificationStatus(certification);
                          const certificationSupported =
                            saved &&
                            ((provider.runtime_provider === "deepseek" &&
                              saved.model_id === "deepseek-v4-flash") ||
                              (provider.runtime_provider === "kimi" &&
                                saved.model_id === "kimi-k3"));
                          const enabled = selected.has(model.id);
                          return (
                            <div
                              key={model.id}
                              className={cn(
                                "flex min-h-14 items-center gap-3 px-4 py-2.5",
                                index > 0 && "border-t border-[var(--color-border-default)]",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate font-mono text-xs font-medium">
                                    {model.id}
                                  </span>
                                  {status && (
                                    <span
                                      className={cn(
                                        "rounded-full px-1.5 py-0.5 text-[9px]",
                                        status.className,
                                      )}
                                    >
                                      {status.label}
                                    </span>
                                  )}
                                  {saved?.is_system_default && (
                                    <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] text-blue-700">
                                      默认
                                    </span>
                                  )}
                                  {saved && certificationSupported && (
                                    <span
                                      className={cn(
                                        "rounded-full px-1.5 py-0.5 text-[9px]",
                                        certificationBadge.className,
                                      )}
                                    >
                                      {certificationBadge.label}
                                    </span>
                                  )}
                                </div>
                                {model.display_name !== model.id && (
                                  <p className="mt-1 truncate text-[10px] text-[var(--color-text-muted)]">
                                    {model.display_name}
                                  </p>
                                )}
                              </div>
                              {saved && certificationSupported && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => setCertifying(saved)}
                                  aria-label={`${certification?.state === "PASS" ? "重新认证" : "认证"} ${saved.model_id}`}
                                >
                                  <ShieldCheck aria-hidden="true" size={13} />
                                  {certification?.state === "PASS" ? "重新认证" : "认证"}
                                </Button>
                              )}
                              <span className="text-[10px] text-[var(--color-text-muted)]">
                                {enabled ? "启动" : "停用"}
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={enabled}
                                aria-label={`${enabled ? "停用" : "启动"} ${model.id}`}
                                disabled={provider.immutable}
                                onClick={() =>
                                  toggleModel(provider.provider_connection_id, model.id)
                                }
                                className={cn(
                                  "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50",
                                  enabled
                                    ? "bg-[var(--color-accent)]"
                                    : "bg-[var(--color-bg-tertiary)]",
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                    enabled && "translate-x-4",
                                  )}
                                />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-2.5">
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        {provider.immutable
                          ? ".env 供应商的启动状态由部署配置锁定"
                          : "启动仍需通过凭据、价格与汇率链校验"}
                      </p>
                      {!provider.immutable && (
                        <Button
                          loading={saving}
                          disabled={directory.length === 0}
                          onClick={() => saveModels(provider)}
                        >
                          <CheckCircle size={14} />
                          保存启动状态
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {deleting === provider.provider_connection_id && (
                  <div className="border-t border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-xs font-medium text-red-800">归档此供应商连接？</p>
                    <p className="mt-1 text-[10px] leading-4 text-red-700">
                      关联模型会全部停用，审计和历史版本仍会保留。
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setDeleting(undefined)}>
                        取消
                      </Button>
                      <Button
                        variant="danger"
                        loading={saving}
                        onClick={() => archiveProvider(provider)}
                      >
                        确认归档
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {certifying && (
        <ModelCertificationDialog
          model={certifying}
          pending={certificationPending}
          isRecertification={
            certificationByProfile.get(certifying.model_profile_id)?.state === "PASS"
          }
          onCancel={() => setCertifying(undefined)}
          onConfirm={() => void submitCertification()}
        />
      )}
    </div>
  );
}
