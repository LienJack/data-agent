"use client";

import { useEffect } from "react";
import { DataSourceMark } from "@/components/data-sources/data-source-mark";
import { getDatabaseTypeConfig } from "@/lib/datasource-types";
import {
  useQAActiveConversationId,
  useQAConversations,
  useQADataSources,
  useQAStore,
} from "@/lib/qa-store";
import { ResourceCardPicker } from "./resource-card-picker";

/**
 * 数据源选择器。
 *
 * 下拉菜单，从 Data Sources 列表获取可选数据源。
 * 选择后更新当前对话的数据源绑定。
 */
export function DataSourceSelector() {
  const loadDataSources = useQAStore((s) => s.loadDataSources);
  const dataSources = useQADataSources();
  const conversations = useQAConversations();
  const activeId = useQAActiveConversationId();

  useEffect(() => {
    loadDataSources();
  }, [loadDataSources]);

  const activeConversation = conversations.find((c) => c.id === activeId);
  const activeDataSourceId = activeConversation?.dataSourceId ?? "";
  const updateResources = useQAStore((state) => state.updateActiveConversationResources);

  return (
    <ResourceCardPicker
      label="数据源"
      value={activeDataSourceId}
      placeholder="自动选择数据源"
      options={dataSources.map((dataSource) => {
        const config = getDatabaseTypeConfig(dataSource.type);
        const location =
          dataSource.type === "sqlite"
            ? (dataSource.path ?? "SQLite 文件")
            : `${dataSource.host ?? "本地"}${dataSource.database ? ` / ${dataSource.database}` : ""}`;
        return {
          id: dataSource.id,
          title: dataSource.name,
          description: location,
          mark: <DataSourceMark type={dataSource.type} size="sm" />,
          badge: config.label,
        };
      })}
      onChange={(dataSourceId) => updateResources({ dataSourceId })}
    />
  );
}
