"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs } from "@/components/ui/tabs";
import type {
  SemanticDimension,
  SemanticMetric,
  SemanticModel,
  SemanticRelation,
  TableMapping,
} from "@/lib/data-link-types";
import { useWorkspaceId } from "@/lib/use-workspace-id";
import { formatDate } from "@/lib/utils";
import { workspacePath } from "@/lib/workspace-routes";

interface ModelDetailProps {
  model: SemanticModel;
}

/**
 * 语义模型详情页。
 *
 * Tab 切换：指标 / 维度 / 表映射 / 关系
 * 每个 Tab 展示对应定义的表格视图。
 * 右上角"编辑"按钮进入语义编辑器。
 */
export function ModelDetail({ model }: ModelDetailProps) {
  const router = useRouter();
  const workspaceId = useWorkspaceId();

  const handleEdit = useCallback(() => {
    router.push(workspacePath(workspaceId, `data-link/editor/${model.id}`));
  }, [router, model.id, workspaceId]);

  const tabs = [
    {
      id: "metrics",
      label: "指标",
      badge: model.metrics.length,
      content: <MetricsTab metrics={model.metrics} />,
    },
    {
      id: "dimensions",
      label: "维度",
      badge: model.dimensions.length,
      content: <DimensionsTab dimensions={model.dimensions} />,
    },
    {
      id: "tables",
      label: "表映射",
      badge: model.tableMappings.length,
      content: <TableMappingsTab mappings={model.tableMappings} />,
    },
    {
      id: "relationships",
      label: "关系",
      badge: model.relationships.length,
      content: <RelationshipsTab relationships={model.relationships} />,
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-[var(--color-text-primary)]">
              {model.name}
            </h1>
            <Badge variant="success">已发布</Badge>
            <Badge variant="outline">v{model.version}</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{model.description}</p>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
            <span>域: {model.domain}</span>
            <span>更新于 {formatDate(model.updatedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="primary" size="sm" onClick={handleEdit}>
            编辑
          </Button>
        </div>
      </div>

      <Separator className="mb-4" />

      {/* Tabs */}
      <Tabs tabs={tabs} />
    </div>
  );
}

// ─── 指标 Tab ──────────────────────────────────────────────────────────────────

function MetricsTab({ metrics }: { metrics: SemanticMetric[] }) {
  if (metrics.length === 0) {
    return <EmptyTab message="暂未定义指标" />;
  }

  return (
    <div className="space-y-2">
      {metrics.map((metric) => (
        <Card key={metric.id} size="sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{metric.name}</CardTitle>
              <Badge variant="secondary">{metric.aggregation}</Badge>
            </div>
            <CardDescription>{metric.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <DetailRow label="公式" value={metric.formula} />
              <DetailRow label="单位" value={metric.unit || "—"} />
              <DetailRow label="粒度" value={metric.grain || "—"} />
              <DetailRow label="表" value={metric.table} />
              <DetailRow label="列" value={metric.column} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── 维度 Tab ──────────────────────────────────────────────────────────────────

function DimensionsTab({ dimensions }: { dimensions: SemanticDimension[] }) {
  if (dimensions.length === 0) {
    return <EmptyTab message="暂未定义维度" />;
  }

  return (
    <div className="space-y-2">
      {dimensions.map((dim) => (
        <Card key={dim.id} size="sm">
          <CardHeader>
            <CardTitle>{dim.name}</CardTitle>
            <CardDescription>{dim.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <DetailRow label="表" value={dim.table} />
              <DetailRow label="列" value={dim.column} />
              {dim.hierarchy && dim.hierarchy.length > 0 && (
                <DetailRow label="层级" value={dim.hierarchy.join(" → ")} />
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── 表映射 Tab ────────────────────────────────────────────────────────────────

function TableMappingsTab({ mappings }: { mappings: TableMapping[] }) {
  if (mappings.length === 0) {
    return <EmptyTab message="暂未定义表映射" />;
  }

  return (
    <div className="space-y-3">
      {mappings.map((mapping) => (
        <Card key={mapping.table} size="sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>{mapping.table}</CardTitle>
              {mapping.alias && <Badge variant="outline">{mapping.alias}</Badge>}
            </div>
            <CardDescription>{mapping.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border-default)] text-left text-[var(--color-text-muted)]">
                    <th className="py-1 pr-3 font-medium">列名</th>
                    <th className="py-1 pr-3 font-medium">类型</th>
                    <th className="py-1 font-medium">描述</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.columns.map((col) => (
                    <tr key={col.name} className="border-b border-[var(--color-border-default)]/50">
                      <td className="py-1 pr-3 text-[var(--color-text-primary)]">
                        {col.name}
                        {col.isPrimaryKey && (
                          <span className="ml-1 text-[var(--color-warning)]">PK</span>
                        )}
                        {col.isForeignKey && (
                          <span className="ml-1 text-[var(--color-accent)]">FK</span>
                        )}
                      </td>
                      <td className="py-1 pr-3 text-[var(--color-text-secondary)]">{col.type}</td>
                      <td className="py-1 text-[var(--color-text-secondary)]">{col.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── 关系 Tab ──────────────────────────────────────────────────────────────────

function RelationshipsTab({ relationships }: { relationships: SemanticRelation[] }) {
  if (relationships.length === 0) {
    return <EmptyTab message="暂未定义关系" />;
  }

  return (
    <div className="space-y-2">
      {relationships.map((rel) => (
        <Card key={rel.id} size="sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{rel.name}</CardTitle>
              <Badge variant="secondary">{rel.type}</Badge>
            </div>
            <CardDescription>{rel.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[var(--color-text-primary)]">
                {rel.sourceTable}
              </span>
              <span className="text-[var(--color-text-muted)]">.</span>
              <span className="text-[var(--color-accent)]">{rel.sourceColumn}</span>
              <span className="text-[var(--color-text-muted)]">→</span>
              <span className="font-medium text-[var(--color-text-primary)]">
                {rel.targetTable}
              </span>
              <span className="text-[var(--color-text-muted)]">.</span>
              <span className="text-[var(--color-accent)]">{rel.targetColumn}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── 辅助组件 ──────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--color-text-muted)]">{label}:</span>
      <span className="text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-[var(--color-text-muted)]">
      {message}
    </div>
  );
}
