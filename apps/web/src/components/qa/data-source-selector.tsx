"use client";

import { useEffect, useMemo } from "react";
import { DataSourceMark } from "@/components/data-sources/data-source-mark";
import { getDatabaseTypeConfig } from "@/lib/datasource-types";
import {
  useQAActiveConversationId,
  useQAConversations,
  useQAResourceCatalog,
  useQAResourceCatalogState,
  useQAResourceError,
  useQAResourceSwitching,
  useQASending,
  useQAStore,
} from "@/lib/qa-store";
import { ResourceCardPicker } from "./resource-card-picker";

export function DataSourceSelector({
  placement = "top",
  compact = true,
}: {
  placement?: "top" | "bottom";
  compact?: boolean;
} = {}) {
  const catalog = useQAResourceCatalog();
  const catalogState = useQAResourceCatalogState();
  const resourceError = useQAResourceError();
  const switching = useQAResourceSwitching();
  const sending = useQASending();
  const conversations = useQAConversations();
  const activeId = useQAActiveConversationId();
  const loadCatalog = useQAStore((state) => state.loadResourceCatalog);
  const updateResources = useQAStore((state) => state.updateActiveConversationResources);

  useEffect(() => {
    if (catalogState === "idle") loadCatalog();
  }, [catalogState, loadCatalog]);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const options = useMemo(
    () =>
      (catalog?.datasources ?? []).map((dataSource) => ({
        id: dataSource.datasource_id,
        title: dataSource.display_name,
        description: `${getDatabaseTypeConfig(dataSource.type).label} · ${dataSource.status === "ACTIVE" ? "连接可用" : "已停用"}`,
        mark: <DataSourceMark type={dataSource.type} size="sm" />,
        badge: dataSource.status === "ACTIVE" ? "可用" : "停用",
        disabled: !dataSource.selectable,
        disabledReason: dataSource.selectable ? undefined : "当前连接不可用于新分析",
      })),
    [catalog],
  );

  return (
    <ResourceCardPicker
      label="数据源"
      value={activeConversation?.dataSourceId ?? ""}
      placeholder="选择数据源"
      options={options}
      onChange={(dataSourceId) => updateResources({ dataSourceId })}
      placement={placement}
      compact={compact}
      disabled={sending}
      pending={switching}
      status={catalogState}
      error={resourceError}
      onRetry={loadCatalog}
    />
  );
}
