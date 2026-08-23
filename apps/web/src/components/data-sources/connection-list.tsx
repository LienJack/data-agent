"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  if (conn.type === "sqlite" || conn.type === "duckdb") {
    return conn.path ?? `${DATABASE_TYPE_CONFIGS[conn.type].label} 文件`;
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
      <div className="surface-reading overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border-default)]">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex gap-3 border-b border-[var(--color-border-default)] p-4 last:border-b-0"
          >
            <Skeleton className="size-9 shrink-0 rounded-[var(--radius-control)]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-2 h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="hidden h-7 w-20 sm:block" />
          </div>
        ))}
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <EmptyState
        title="暂未配置数据源"
        description="添加数据源连接以开始使用数据分析功能。支持 PostgreSQL、MySQL、ClickHouse、SQLite 和 DuckDB。"
      />
    );
  }

  return (
    <section
      aria-label="已配置的数据源连接"
      className="surface-reading overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border-default)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">连接目录</h2>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            连接状态、目标位置和传输安全配置
          </p>
        </div>
        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
          {connections.length} connections
        </span>
      </div>
      {connections.map((conn) => {
        const config = DATABASE_TYPE_CONFIGS[conn.type];
        return (
          <article
            key={conn.id}
            className="group border-b border-[var(--color-border-default)] px-4 py-4 transition-colors last:border-b-0 hover:bg-[color-mix(in_srgb,var(--color-accent)_3%,transparent)]"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <DataSourceMark type={conn.type} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                      {conn.name}
                    </h3>
                    <Badge variant="outline">{config?.label ?? conn.type}</Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {describeConnection(conn)}
                  </p>
                  <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px]">
                    {conn.catalog && (
                      <div className="flex items-center gap-1.5">
                        <dt className="text-[var(--color-text-muted)]">Catalog</dt>
                        <dd className="text-[var(--color-text-secondary)]">{conn.catalog}</dd>
                      </div>
                    )}
                    {conn.schema && (
                      <div className="flex items-center gap-1.5">
                        <dt className="text-[var(--color-text-muted)]">Schema</dt>
                        <dd className="text-[var(--color-text-secondary)]">{conn.schema}</dd>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <dt className="text-[var(--color-text-muted)]">传输</dt>
                      <dd className="text-[var(--color-text-secondary)]">
                        {conn.ssl && conn.ssl !== "disable" ? `SSL ${conn.ssl}` : "未启用 SSL"}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-[var(--color-text-muted)]">更新</dt>
                      <dd className="text-[var(--color-text-secondary)]">
                        {formatDate(conn.updatedAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setDeleteConfirm(deleteConfirm === conn.id ? null : conn.id)}
                >
                  删除
                </Button>
              </div>
            </div>

            {deleteConfirm === conn.id && (
              <div className="mt-3 rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-3">
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
          </article>
        );
      })}
    </section>
  );
}
