/**
 * Data Sources API 客户端。
 */

import type {
  CreateDataSourceInput,
  DataSourceConnection,
  TestConnectionInput,
  TestConnectionResult,
} from "./datasource-types";

const API_BASE = "/api/datasources";

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
  return request<DataSourceConnection[]>(API_BASE);
}

/** 创建数据源连接 */
export async function createDataSource(
  input: CreateDataSourceInput,
): Promise<DataSourceConnection> {
  return request<DataSourceConnection>(API_BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 删除数据源连接 */
export async function deleteDataSource(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** 测试数据库连接 */
export async function testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
  return request<TestConnectionResult>(`${API_BASE}/test`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
