/**
 * Data Sources API 客户端。
 */

import type { WorkspaceDatasource } from "@data-agent/contracts";
import { resolveWorkspaceId } from "./api-client";
import type {
  CreateDataSourceInput,
  DataSourceConnection,
  TestConnectionInput,
  TestConnectionResult,
} from "./datasource-types";

function workspaceApiBase(): string {
  const workspaceId = resolveWorkspaceId();
  if (!workspaceId) throw new Error("请先选择工作空间");
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/datasources`;
}

function fromContract(value: WorkspaceDatasource): DataSourceConnection {
  return {
    id: value.datasource_id,
    name: value.name,
    type: value.type,
    host: value.host ?? undefined,
    port: value.port ?? undefined,
    database: value.database ?? undefined,
    username: value.username ?? undefined,
    credentialRef: value.credential_ref ?? undefined,
    ssl: value.ssl,
    path: value.path ?? undefined,
    catalog: value.catalog ?? undefined,
    schema: value.schema ?? undefined,
    status: value.status === "ACTIVE" ? "active" : value.status === "ERROR" ? "error" : "unknown",
    lastTestedAt: value.last_tested_at ?? undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

// ─── 通用请求 ──────────────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error?.message ?? `请求失败 (${response.status})`);
  }
  const json = (await response.json()) as { data: T };
  return json.data;
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

/** 获取所有数据源连接 */
export async function fetchDataSources(): Promise<DataSourceConnection[]> {
  return (await request<WorkspaceDatasource[]>(workspaceApiBase())).map(fromContract);
}

/** 创建数据源连接 */
export async function createDataSource(
  input: CreateDataSourceInput,
): Promise<DataSourceConnection> {
  const created = await request<WorkspaceDatasource>(workspaceApiBase(), {
    method: "POST",
    body: JSON.stringify({
      schema_version: "workspace-datasource-create@1.0.0",
      name: input.name,
      type: input.type,
      host: input.host ?? null,
      port: input.port ?? null,
      database: input.database ?? null,
      username: input.username ?? null,
      credential_ref: input.credentialRef ?? null,
      ssl: input.ssl ?? "disable",
      path: input.path ?? null,
      catalog: input.catalog ?? null,
      schema: input.schema ?? null,
    }),
  });
  return fromContract(created);
}

/** 删除数据源连接 */
export async function deleteDataSource(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`${workspaceApiBase()}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** 测试数据库连接 */
export async function testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
  return request<TestConnectionResult>(`${workspaceApiBase()}/test`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
