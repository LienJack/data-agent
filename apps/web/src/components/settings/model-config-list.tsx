"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getModelProviderCatalogItem, MODEL_PROVIDER_CATALOG } from "@/lib/model-provider-catalog";
import {
  useModelConfigs,
  useModelSettingsLoading,
  useModelSettingsStore,
} from "@/lib/settings-store";
import { formatDate } from "@/lib/utils";
import { ProviderMark } from "./provider-mark";

/**
 * 模型配置列表。
 *
 * 展示环境系统模型与手工配置。
 */
export function ModelConfigList() {
  const removeModel = useModelSettingsStore((s) => s.removeModel);
  const models = useModelConfigs();
  const loading = useModelSettingsLoading();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const providerGroups = useMemo(
    () =>
      MODEL_PROVIDER_CATALOG.map((provider) => ({
        provider,
        models: models.filter((model) => model.vendorId === provider.id),
      })).filter((group) => group.models.length > 0),
    [models],
  );

  const handleDelete = async (id: string) => {
    await removeModel(id);
    setDeleteConfirm(null);
  };

  if (loading && models.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4"
          >
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-2 h-4 w-64" />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <EmptyState
        title="暂未配置模型"
        description="选择模型供应商并启用模型，再填写该供应商的 API Key 与 Base URL。"
      />
    );
  }

  return (
    <div className="space-y-3">
      {providerGroups.map(({ provider, models: providerModels }) => (
        <Card key={provider.id} className="gap-0 py-0">
          <CardHeader className="border-b border-[var(--color-border-default)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ProviderMark vendorId={provider.id} size="md" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{provider.label}</CardTitle>
                    <Badge variant="outline">{providerModels.length} 个模型</Badge>
                    <Badge variant="outline">{provider.connectionLabel}</Badge>
                  </div>
                  <CardDescription className="mt-1 truncate">
                    {provider.description}
                  </CardDescription>
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                已配置
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {providerModels.map((model, index) => {
              const preset = getModelProviderCatalogItem(model.vendorId).models.find(
                (candidate) => candidate.id === model.modelName,
              );
              return (
                <div
                  key={model.id}
                  className={
                    index > 0 ? "border-t border-[var(--color-border-default)]" : undefined
                  }
                >
                  <div className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                    <ProviderMark vendorId={model.vendorId} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
                          {model.modelName}
                        </span>
                        {(preset?.capabilities ?? ["LLM"]).map((capability) => (
                          <span
                            key={capability}
                            className="rounded border border-[var(--color-border-overlay)] px-1.5 py-0.5 text-[9px] leading-none text-[var(--color-text-secondary)]"
                          >
                            {capability}
                          </span>
                        ))}
                        {model.isSystemDefault && <Badge variant="success">系统默认</Badge>}
                        {model.isSystemModel && !model.isSystemDefault && (
                          <Badge variant="outline">系统模型</Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-text-muted)]">
                        <span>{model.name}</span>
                        <span>API Key {model.apiKeyMasked}</span>
                        <span>
                          {model.connectionStatus === "configured" ? "待运行验证" : "尚未验证"}
                        </span>
                        <span>更新于 {formatDate(model.updatedAt)}</span>
                      </div>
                    </div>
                    {!model.isSystemModel && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() =>
                          setDeleteConfirm(deleteConfirm === model.id ? null : model.id)
                        }
                      >
                        删除
                      </Button>
                    )}
                  </div>
                  {deleteConfirm === model.id && (
                    <div className="flex items-center justify-end gap-2 border-t border-red-100 bg-red-50 px-4 py-2">
                      <span className="mr-auto text-xs text-red-700">确认删除此模型配置？</span>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(model.id)}>
                        确认删除
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>
                        取消
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
