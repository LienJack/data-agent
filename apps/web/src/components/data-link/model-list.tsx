"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDataLinkError,
  useDataLinkLoading,
  useDataLinkModels,
  useDataLinkStore,
} from "@/lib/data-link-store";
import { useWorkspaceId } from "@/lib/use-workspace-id";
import { formatDate } from "@/lib/utils";
import { workspacePath } from "@/lib/workspace-routes";

/**
 * 语义模型列表 — 展示所有已发布的语义模型。
 *
 * 卡片式布局，每张卡片显示模型名称、域、描述、版本和更新时间。
 * 点击卡片进入模型详情页。
 */
export function ModelList() {
  const workspaceId = useWorkspaceId();
  const loadModels = useDataLinkStore((s) => s.loadModels);
  const models = useDataLinkModels();
  const loading = useDataLinkLoading();
  const error = useDataLinkError();

  useEffect(() => {
    if (workspaceId) loadModels();
  }, [loadModels, workspaceId]);

  if (loading) {
    return <ModelListSkeleton />;
  }

  if (error) {
    return (
      <EmptyState
        title="加载失败"
        description={error}
        action={
          <button
            type="button"
            onClick={() => loadModels()}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            重试
          </button>
        }
      />
    );
  }

  if (models.length === 0) {
    return (
      <EmptyState
        title="暂无语义模型"
        description="尚未发布任何语义模型。您可以在 Data Link 中创建新的语义定义。"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {models.map((model) => (
        <Link
          key={model.id}
          href={workspacePath(workspaceId, `data-link/models/${model.id}`)}
          className="block"
        >
          <Card className="h-full transition-colors hover:border-[var(--color-border-focused)]">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{model.name}</CardTitle>
                <Badge variant="success">已发布</Badge>
              </div>
              <CardDescription>{model.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{model.domain}</Badge>
                <Badge variant="outline">v{model.version}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
                <span>指标 {model.metrics.length}</span>
                <span>维度 {model.dimensions.length}</span>
                <span>表 {model.tableMappings.length}</span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                {formatDate(model.updatedAt)}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function ModelListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-12" />
          </div>
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1 h-4 w-3/4" />
          <div className="mt-3 flex gap-1.5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-12" />
          </div>
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
