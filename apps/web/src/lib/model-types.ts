/**
 * Model Settings 类型定义。
 *
 * 环境系统模型与手工 OpenAI 兼容配置的公开投影。
 */

import type { ModelProvider } from "@data-agent/contracts";

export const MODEL_VENDOR_IDS = [
  "openai",
  "anthropic",
  "deepseek",
  "glm",
  "kimi",
  "grok",
  "gemini",
  "volcengine",
  "siliconflow",
  "openai-compatible",
] as const;

/** 用户在设置页选择的真实供应商或第三方模型平台。 */
export type ModelVendorId = (typeof MODEL_VENDOR_IDS)[number];

export type ModelConfigSource = "environment" | "manual";

export type ModelConnectionStatus = "configured" | "unchecked";

/** 模型配置 */
export interface ModelConfig {
  id: string;
  name: string;
  vendorId: ModelVendorId;
  /** 实际调用时使用的运行时协议；第三方聚合平台当前使用 OpenAI 兼容协议。 */
  provider: ModelProvider;
  modelName: string;
  source: ModelConfigSource;
  isSystemModel: boolean;
  isSystemDefault: boolean;
  connectionStatus: ModelConnectionStatus;
  /** API Key 始终仅保留在服务端，此字段只是安全的显示文本。 */
  apiKeyMasked: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** 创建模型配置请求 */
export interface CreateModelConfigInput {
  name: string;
  apiKey: string;
  baseUrl: string;
  vendorId?: ModelVendorId;
  provider?: ModelProvider;
  modelName?: string;
}

/** 从供应商目录读取模型时使用的临时凭据，只提交到本项目服务端。 */
export interface DiscoverProviderModelsInput {
  vendorId: ModelVendorId;
  apiKey: string;
  baseUrl: string;
}

/** 供应商模型目录的安全投影，不包含凭据和未经验证的价格信息。 */
export interface DiscoveredProviderModel {
  id: string;
  displayName: string;
  description?: string;
}

/** 模型配置列表项（不含 API Key） */
export interface ModelConfigListItem {
  id: string;
  name: string;
  vendorId: ModelVendorId;
  provider: ModelProvider;
  modelName: string;
  source: ModelConfigSource;
  isSystemModel: boolean;
  isSystemDefault: boolean;
  connectionStatus: ModelConnectionStatus;
  apiKeyMasked: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}
