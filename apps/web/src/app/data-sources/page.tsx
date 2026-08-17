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
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-[var(--color-text-primary)]">
              Data Sources
            </h1>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              管理数据源连接 — 支持 PostgreSQL、MySQL、ClickHouse、SQLite 和 DuckDB
            </p>
          </div>
          {!showForm && (
            <Button variant="primary" size="md" onClick={() => setShowForm(true)}>
              添加连接
            </Button>
          )}
        </div>

        {showForm && <ConnectionForm />}

        {!showForm && (
          <div className="space-y-5">
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
