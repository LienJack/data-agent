/**
 * Model Settings API 客户端。
 */

import type {
  CreateModelConfigInput,
  DiscoveredProviderModel,
  DiscoverProviderModelsInput,
  ModelConfig,
  ModelConfigListItem,
} from "./model-types";

const API_BASE = "/api/models";

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

/** 获取所有模型配置 */
export async function fetchModels(): Promise<ModelConfigListItem[]> {
  return request<ModelConfigListItem[]>(API_BASE);
}

/** 创建模型配置 */
export async function createModel(input: CreateModelConfigInput): Promise<ModelConfig> {
  return request<ModelConfig>(API_BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 使用临时凭据从供应商读取当前账号可用的模型目录。 */
export async function discoverProviderModels(
  input: DiscoverProviderModelsInput,
): Promise<DiscoveredProviderModel[]> {
  return request<DiscoveredProviderModel[]>(`${API_BASE}/discover`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 删除模型配置 */
export async function deleteModel(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
