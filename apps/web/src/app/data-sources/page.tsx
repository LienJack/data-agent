"use client";

import type { DatasourceAdapterRegistrySnapshot } from "@data-agent/contracts";
import { useEffect, useState } from "react";
import { ConnectionForm } from "@/components/data-sources/connection-form";
import { ConnectionList } from "@/components/data-sources/connection-list";
import { DatasourceGallery } from "@/components/settings/datasource-gallery";
import { Button } from "@/components/ui/button";
import { fetchDatasourceAdapterRegistry } from "@/lib/datasource-api";
import { useDataSourceShowForm, useDataSourceStore } from "@/lib/datasource-store";

type AdapterState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly snapshot: DatasourceAdapterRegistrySnapshot };

/**
 * Data Sources 管理页面。
 *
 * 展示所有已配置的数据源连接列表。
 * 支持添加、删除和测试连接操作。
 */
export default function DataSourcesPage() {
  const loadConnections = useDataSourceStore((s) => s.loadConnections);
  const setShowForm = useDataSourceStore((s) => s.setShowForm);
  const showForm = useDataSourceShowForm();
  const [adapters, setAdapters] = useState<AdapterState>({ status: "loading" });

  useEffect(() => {
    loadConnections();
    void fetchDatasourceAdapterRegistry()
      .then((snapshot) => setAdapters({ status: "ready", snapshot }))
      .catch((error: unknown) =>
        setAdapters({
          status: "error",
          message: error instanceof Error ? error.message : "Adapter Registry 加载失败",
        }),
      );
  }, [loadConnections]);

  return (
    <div className="workspace-container">
      <div className="workspace-section">
        <header className="page-heading">
          <div>
            <p className="page-eyebrow">Workspace / Connections</p>
            <h1 className="page-title">数据源</h1>
            <p className="page-description">
              管理数据源连接 — 支持 PostgreSQL、MySQL、ClickHouse、SQLite 和 DuckDB
            </p>
          </div>
          {!showForm && (
            <Button variant="primary" size="md" onClick={() => setShowForm(true)}>
              添加连接
            </Button>
          )}
        </header>

        {showForm && (
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,880px)_minmax(240px,1fr)]">
            <ConnectionForm />
            <aside className="surface-floating h-fit rounded-[var(--radius-panel)] border border-[var(--color-border-default)] p-5">
              <p className="page-eyebrow">Connection policy</p>
              <h2 className="mt-2 text-sm font-semibold">连接前检查</h2>
              <ol className="mt-4 space-y-3 text-xs leading-5 text-[var(--color-text-secondary)]">
                <li>1. 确认目标网络与端口可从运行环境访问。</li>
                <li>2. 生产凭据仅通过 Secret Provider 引用。</li>
                <li>3. 保存前先执行连接测试，避免无效配置进入目录。</li>
              </ol>
            </aside>
          </div>
        )}

        {!showForm && (
          <div className="mt-5 space-y-5">
            {adapters.status === "loading" && (
              <p className="text-xs text-[var(--color-text-muted)]" role="status">
                正在加载 Adapter Registry...
              </p>
            )}
            {adapters.status === "error" && (
              <p className="text-xs text-red-700" role="alert">
                {adapters.message}
              </p>
            )}
            {adapters.status === "ready" && <DatasourceGallery snapshot={adapters.snapshot} />}
            <ConnectionList />
          </div>
        )}
      </div>
    </div>
  );
}
