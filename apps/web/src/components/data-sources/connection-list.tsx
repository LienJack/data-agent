"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDataSourceConnections,
  useDataSourceLoading,
  useDataSourceStore,
} from "@/lib/datasource-store";
import type { DataSourceConnection } from "@/lib/datasource-types";
import { DATABASE_TYPE_CONFIGS } from "@/lib/datasource-types";
import { formatDate } from "@/lib/utils";
import { DataSourceMark } from "./data-source-mark";

function describeConnection(conn: DataSourceConnection) {
  if (conn.type === "sqlite") {
    return conn.path ?? "SQLite 文件";
  }
  if (conn.type === "trino") {
    const catalog = conn.catalog ?? "catalog";
    const schema = conn.schema ?? "schema";
    return `${conn.host}:${conn.port ?? 8080}/${catalog}.${schema}`;
  }
  return `${conn.host}:${conn.port}/${conn.database}`;
}

/**
 * 数据源连接列表。
 *
 * 展示所有已配置的数据源连接。
 * 支持添加、删除和测试连接操作。
 */
export function ConnectionList() {
  const removeConnection = useDataSourceStore((s) => s.removeConnection);
  const connections = useDataSourceConnections();
  const loading = useDataSourceLoading();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    await removeConnection(id);
    setDeleteConfirm(null);
  };

  if (loading && connections.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4"
          >
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-2 h-4 w-32" />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <EmptyState
        title="暂未配置数据源"
        description="添加数据源连接以开始使用数据分析功能。支持 PostgreSQL、MySQL、ClickHouse、SQLite 和 Trino。"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {connections.map((conn) => {
        const config = DATABASE_TYPE_CONFIGS[conn.type];
        return (
          <Card
            key={conn.id}
            className="min-h-44 gap-0 py-0 transition-all hover:-translate-y-0.5 hover:border-[var(--color-border-focused)] hover:shadow-[0_10px_24px_rgb(23_26_24_/_0.07)]"
          >
            <CardHeader className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <DataSourceMark type={conn.type} size="md" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{conn.name}</CardTitle>
                      <Badge variant="outline">{config?.label ?? conn.type}</Badge>
                    </div>
                    <CardDescription className="mt-1 truncate">
                      {describeConnection(conn)}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      conn.status === "active"
                        ? "bg-[var(--color-success)]"
                        : conn.status === "error"
                          ? "bg-[var(--color-error)]"
                          : "bg-[var(--color-text-disabled)]"
                    }`}
                  />
                  <span>
                    {conn.status === "active" ? "正常" : conn.status === "error" ? "错误" : "未知"}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col border-t border-[var(--color-border-default)] px-4 py-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
                {conn.host && (
                  <div>
                    <dt className="text-[var(--color-text-muted)]">主机</dt>
                    <dd className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                      {conn.host}
                    </dd>
                  </div>
                )}
                {conn.database && (
                  <div>
                    <dt className="text-[var(--color-text-muted)]">数据库</dt>
                    <dd className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                      {conn.database}
                    </dd>
                  </div>
                )}
                {conn.path && (
                  <div className="col-span-2">
                    <dt className="text-[var(--color-text-muted)]">文件路径</dt>
                    <dd className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                      {conn.path}
                    </dd>
                  </div>
                )}
                {conn.catalog && (
                  <div>
                    <dt className="text-[var(--color-text-muted)]">Catalog</dt>
                    <dd className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                      {conn.catalog}
                    </dd>
                  </div>
                )}
                {conn.schema && (
                  <div>
                    <dt className="text-[var(--color-text-muted)]">Schema</dt>
                    <dd className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                      {conn.schema}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[10px] text-[var(--color-text-muted)]">
                <span>
                  {conn.ssl && conn.ssl !== "disable" ? `SSL ${conn.ssl}` : "未启用 SSL"} · 更新于
                  {formatDate(conn.updatedAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setDeleteConfirm(deleteConfirm === conn.id ? null : conn.id)}
                >
                  删除
                </Button>
              </div>

              {deleteConfirm === conn.id && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
                  <span className="block text-xs text-red-700">确认删除此数据源？</span>
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="danger" size="sm" onClick={() => handleDelete(conn.id)}>
                      确认删除
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
