"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { discoverProviderModels } from "@/lib/model-api";
import {
  getModelProviderCatalogItem,
  type ModelCapabilityLabel,
  NATIVE_MODEL_PROVIDER_CATALOG,
  THIRD_PARTY_MODEL_PROVIDER_CATALOG,
} from "@/lib/model-provider-catalog";
import type { DiscoveredProviderModel, ModelVendorId } from "@/lib/model-types";
import { useModelSettingsStore } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { ProviderMark } from "./provider-mark";

/**
 * 模型配置表单。
 *
 * 两段式卡片配置：先选择供应商，再选择供应商内的模型并填写凭据。
 */
export function ModelConfigForm() {
  const addModels = useModelSettingsStore((s) => s.addModels);
  const setShowForm = useModelSettingsStore((s) => s.setShowForm);

  const [vendorId, setVendorId] = useState<ModelVendorId | null>(null);
  const [profileName, setProfileName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [customModelDraft, setCustomModelDraft] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredProviderModel[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<
    "idle" | "loading" | "success" | "error" | "stale"
  >("idle");
  const [discoveryError, setDiscoveryError] = useState<string | undefined>();
  const discoveryRequestVersion = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const providerConfig = vendorId ? getModelProviderCatalogItem(vendorId) : null;
  const modelOptions = useMemo(() => {
    const catalogModels =
      discoveredModels.length > 0 || discoveryStatus === "success"
        ? discoveredModels.map((model) => {
            const preset = providerConfig?.models.find((candidate) => candidate.id === model.id);
            return {
              id: model.id,
              capabilities: preset?.capabilities ?? (["LLM"] as readonly ModelCapabilityLabel[]),
              description:
                model.description ??
                (model.displayName !== model.id ? model.displayName : undefined) ??
                preset?.description ??
                "供应商返回的可用模型",
            };
          })
        : [...(providerConfig?.models ?? [])];

    return [
      ...catalogModels,
      ...customModels.map((id) => ({
        id,
        capabilities: ["LLM"] as readonly ModelCapabilityLabel[],
        description: "自定义模型 ID",
      })),
    ];
  }, [providerConfig, customModels, discoveredModels, discoveryStatus]);

  const handleProviderSelect = useCallback((nextVendorId: ModelVendorId) => {
    const nextConfig = getModelProviderCatalogItem(nextVendorId);
    discoveryRequestVersion.current += 1;
    setVendorId(nextVendorId);
    setProfileName(`${nextConfig.label} 配置`);
    setApiKey("");
    setBaseUrl(nextConfig.defaultBaseUrl);
    setSelectedModels(nextConfig.models.map((model) => model.id));
    setCustomModels([]);
    setCustomModelDraft("");
    setDiscoveredModels([]);
    setDiscoveryStatus("idle");
    setDiscoveryError(undefined);
    setError(undefined);
  }, []);

  const invalidateDiscovery = useCallback(() => {
    discoveryRequestVersion.current += 1;
    setDiscoveryStatus((current) =>
      discoveredModels.length > 0 || current === "success" || current === "stale"
        ? "stale"
        : "idle",
    );
    setDiscoveryError(undefined);
  }, [discoveredModels.length]);

  const handleDiscoverModels = useCallback(async () => {
    if (!providerConfig || !apiKey.trim() || !baseUrl.trim()) {
      setDiscoveryStatus("error");
      setDiscoveryError("请先填写 API Key 与 Base URL");
      return;
    }

    setDiscoveryStatus("loading");
    setDiscoveryError(undefined);
    const requestVersion = ++discoveryRequestVersion.current;
    try {
      const models = await discoverProviderModels({
        vendorId: providerConfig.id,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
      });
      if (requestVersion !== discoveryRequestVersion.current) return;
      const modelIds = new Set(models.map((model) => model.id));
      setDiscoveredModels(models);
      setCustomModels((current) => current.filter((modelId) => !modelIds.has(modelId)));
      setSelectedModels((current) =>
        current.filter((modelId) => modelIds.has(modelId) || customModels.includes(modelId)),
      );
      setDiscoveryStatus("success");
    } catch (err) {
      if (requestVersion !== discoveryRequestVersion.current) return;
      setDiscoveryStatus("error");
      setDiscoveryError(err instanceof Error ? err.message : "获取模型目录失败");
    }
  }, [providerConfig, apiKey, baseUrl, customModels]);

  const toggleModel = useCallback((modelId: string) => {
    setSelectedModels((current) =>
      current.includes(modelId)
        ? current.filter((candidate) => candidate !== modelId)
        : [...current, modelId],
    );
  }, []);

  const addCustomModel = useCallback(() => {
    const modelId = customModelDraft.trim();
    if (!modelId) return;
    if (!modelOptions.some((model) => model.id === modelId)) {
      setCustomModels((current) => [...current, modelId]);
      setSelectedModels((current) => [...current, modelId]);
    }
    setCustomModelDraft("");
  }, [customModelDraft, modelOptions]);

  const handleSubmit = useCallback(async () => {
    if (!providerConfig || !profileName.trim() || !apiKey.trim() || !baseUrl.trim()) {
      setError("请填写所有必填字段");
      return;
    }
    if (selectedModels.length === 0) {
      setError("请至少启用一个模型");
      return;
    }

    setSubmitting(true);
    setError(undefined);

    try {
      await addModels(
        selectedModels.map((modelName) => ({
          name:
            selectedModels.length === 1
              ? profileName.trim()
              : `${profileName.trim()} · ${modelName}`,
          vendorId: providerConfig.id,
          provider: providerConfig.runtimeProvider,
          modelName,
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }, [providerConfig, profileName, apiKey, baseUrl, selectedModels, addModels]);

  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] shadow-[0_8px_30px_rgb(23_26_24_/_0.05)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {providerConfig ? `配置 ${providerConfig.label}` : "选择模型供应商"}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {providerConfig
              ? "连接供应商并获取模型目录，再选择需要启用的模型"
              : "先选择供应商，再配置供应商内可用的模型"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
          取消
        </Button>
      </div>

      {!providerConfig ? (
        <div className="space-y-5 p-4">
          {[
            {
              id: "native",
              title: "原生模型供应商",
              description: "使用已注册的供应商运行时与部署预设",
              items: NATIVE_MODEL_PROVIDER_CATALOG,
            },
            {
              id: "third-party",
              title: "第三方模型平台",
              description: "通过 OpenAI 兼容协议接入平台模型或推理接入点",
              items: THIRD_PARTY_MODEL_PROVIDER_CATALOG,
            },
          ].map((section) => (
            <section key={section.id} aria-labelledby={`provider-section-${section.id}`}>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3
                    id={`provider-section-${section.id}`}
                    className="text-xs font-semibold text-[var(--color-text-primary)]"
                  >
                    {section.title}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                    {section.description}
                  </p>
                </div>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {section.items.length} 个可选平台
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleProviderSelect(item.id)}
                    className="group min-h-36 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4 text-left shadow-[0_1px_2px_rgb(23_26_24_/_0.03)] transition-all hover:-translate-y-0.5 hover:border-[var(--color-border-focused)] hover:shadow-[0_10px_24px_rgb(23_26_24_/_0.08)] focus-visible:border-[var(--color-border-focused)] focus-visible:outline-none"
                  >
                    <span className="flex items-start gap-3">
                      <ProviderMark vendorId={item.id} size="lg" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                            {item.label}
                          </span>
                          <span className="shrink-0 rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[9px] font-medium text-[var(--color-text-secondary)]">
                            {item.connectionLabel}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">
                          {item.owner} ·{" "}
                          {item.models.length > 0
                            ? `${item.models.length} 个部署预设`
                            : "自定义模型 ID"}
                        </span>
                      </span>
                    </span>
                    <span className="mt-3 block text-xs leading-5 text-[var(--color-text-secondary)]">
                      {item.description}
                    </span>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      选择并配置 <span aria-hidden="true">→</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-4 py-3">
            <div className="flex items-center gap-3">
              <ProviderMark vendorId={providerConfig.id} size="lg" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {providerConfig.label}
                  </span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    {selectedModels.length} 个模型已选择
                  </span>
                  <span className="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
                    {providerConfig.connectionLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {providerConfig.description}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setVendorId(null)}>
              更换供应商
            </Button>
          </div>

          <div className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">
                  连接供应商
                </h3>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  模型目录由服务端读取，API Key 不会写入目录响应
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  discoveryStatus === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : discoveryStatus === "error"
                      ? "bg-red-50 text-red-700"
                      : discoveryStatus === "stale"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]",
                )}
              >
                {discoveryStatus === "success"
                  ? "目录已同步"
                  : discoveryStatus === "loading"
                    ? "正在获取"
                    : discoveryStatus === "error"
                      ? "获取失败"
                      : discoveryStatus === "stale"
                        ? "连接已变更"
                        : "尚未获取"}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                  配置名称
                </span>
                <input
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder={`${providerConfig.label} 配置`}
                  className="w-full rounded-md border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                  API Key
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    invalidateDiscovery();
                  }}
                  placeholder="仅保存在服务端"
                  className="w-full rounded-md border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
                />
              </label>
              <div className="md:col-span-2">
                <label
                  htmlFor="model-provider-base-url"
                  className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
                >
                  Base URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="model-provider-base-url"
                    type="url"
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value);
                      invalidateDiscovery();
                    }}
                    placeholder={providerConfig.defaultBaseUrl}
                    className="min-w-0 flex-1 rounded-md border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    loading={discoveryStatus === "loading"}
                    onClick={handleDiscoverModels}
                  >
                    获取模型列表
                  </Button>
                </div>
              </div>
            </div>

            {discoveryError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {discoveryError}
              </div>
            )}
            {discoveryStatus === "stale" && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                连接信息已改变，请重新获取模型列表后再确认启用状态。
              </div>
            )}
          </div>

          <div className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">启用模型</h3>
                <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                  开关决定保存后可供 Q&A 选择的模型；关闭的模型不会创建配置
                </p>
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {modelOptions.length} 个可选模型
              </span>
            </div>

            <div className="max-h-96 overflow-y-auto rounded-lg border border-[var(--color-border-default)]">
              {discoveryStatus === "loading" && (
                <div className="flex min-h-14 items-center gap-3 bg-[var(--color-bg-canvas)] px-3 py-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-accent)]" />
                  <div>
                    <p className="text-xs font-medium text-[var(--color-text-primary)]">
                      正在从 {providerConfig.label} 获取模型目录
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                      获取完成后可逐个调整启用状态
                    </p>
                  </div>
                </div>
              )}
              {modelOptions.length === 0 && (
                <div className="flex min-h-20 items-center gap-3 bg-white px-3 py-3">
                  <ProviderMark vendorId={providerConfig.id} size="sm" />
                  <div>
                    <p className="text-xs font-medium text-[var(--color-text-primary)]">
                      {discoveryStatus === "success" ? "供应商未返回可用模型" : "获取或添加模型"}
                    </p>
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                      可先获取供应商模型列表，也可以填写控制台显示的模型或接入点 ID。
                    </p>
                  </div>
                </div>
              )}
              {modelOptions.map((model, index) => {
                const selected = selectedModels.includes(model.id);
                return (
                  <div
                    key={model.id}
                    className={cn(
                      "flex min-h-14 items-center gap-3 px-3 py-2 transition-colors",
                      index > 0 && "border-t border-[var(--color-border-default)]",
                      selected ? "bg-[var(--color-selection-selected-bg)]" : "bg-white",
                    )}
                  >
                    <ProviderMark vendorId={providerConfig.id} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {model.id}
                        </span>
                        {model.capabilities.map((capability) => (
                          <span
                            key={capability}
                            className="rounded border border-[var(--color-border-overlay)] bg-white px-1.5 py-0.5 text-[9px] font-medium leading-none text-[var(--color-text-secondary)]"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 truncate text-[10px] text-[var(--color-text-muted)]">
                        {model.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="w-8 text-right text-[10px] text-[var(--color-text-muted)]">
                        {selected ? "启用" : "停用"}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={selected}
                        aria-label={`${selected ? "停用" : "启用"} ${model.id}`}
                        onClick={() => toggleModel(model.id)}
                        className={cn(
                          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                          selected ? "bg-[var(--color-accent)]" : "bg-[var(--color-bg-tertiary)]",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                            selected ? "translate-x-4" : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={customModelDraft}
                onChange={(event) => setCustomModelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomModel();
                  }
                }}
                placeholder={providerConfig.modelIdPlaceholder}
                className="min-w-0 flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={!customModelDraft.trim()}
                onClick={addCustomModel}
              >
                添加模型
              </Button>
            </div>
          </div>

          <div className="border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-4">
            {error && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setShowForm(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                size="md"
                loading={submitting}
                disabled={selectedModels.length === 0}
                onClick={handleSubmit}
              >
                保存 {selectedModels.length > 0 ? `${selectedModels.length} 个模型` : "配置"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
