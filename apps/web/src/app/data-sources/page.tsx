"use client";

import { useEffect } from "react";
import { ConnectionForm } from "@/components/data-sources/connection-form";
import { ConnectionList } from "@/components/data-sources/connection-list";
import { Button } from "@/components/ui/button";
import { useDataSourceShowForm, useDataSourceStore } from "@/lib/datasource-store";

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

  useEffect(() => {
    loadConnections();
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
              管理数据源连接 — 支持 PostgreSQL、MySQL、ClickHouse、SQLite 和 Trino
            </p>
          </div>
          {!showForm && (
            <Button variant="primary" size="md" onClick={() => setShowForm(true)}>
              添加连接
            </Button>
          )}
        </div>

        {showForm && <ConnectionForm />}

        {!showForm && <ConnectionList />}
      </div>
    </div>
  );
}
