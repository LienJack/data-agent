import type { ModelProvider, ModelVendorId } from "@data-agent/contracts";

export type ModelCapabilityLabel = "LLM" | "结构化输出" | "工具调用" | "流式" | "推理" | "视觉";

export interface ModelPreset {
  id: string;
  capabilities: readonly ModelCapabilityLabel[];
  description: string;
}

export interface ModelProviderCatalogItem {
  id: ModelVendorId;
  runtimeProvider: ModelProvider;
  group: "native" | "third-party";
  connectionLabel: "原生接入" | "OpenAI 兼容";
  label: string;
  owner: string;
  description: string;
  defaultBaseUrl: string;
  mark: string;
  markBackground: string;
  markForeground: string;
  /** 本地打包的供应商品牌 SVG；自定义兼容平台没有对应品牌图标。 */
  iconPath?: string;
  /** 用于深色品牌底上的单色 SVG。 */
  iconTreatment?: "invert";
  modelIdPlaceholder: string;
  models: readonly ModelPreset[];
}

const UNIVERSAL_CAPABILITIES = ["LLM", "结构化输出", "工具调用", "流式", "推理"] as const;

/**
 * 面向 Web 的供应商展示目录。
 *
 * 模型 ID 与 packages/agent-runtime/src/models/bindings.ts 的部署默认值保持一致；
 * 这里不声明尚未通过运行时验证的上下文窗口、价格或区域能力。
 */
export const MODEL_PROVIDER_CATALOG = [
  {
    id: "openai",
    runtimeProvider: "openai",
    group: "native",
    connectionLabel: "原生接入",
    label: "OpenAI",
    owner: "OpenAI",
    description: "通用推理、工具调用与视觉模型",
    defaultBaseUrl: "https://api.openai.com/v1",
    mark: "OA",
    markBackground: "#0f9f6e",
    markForeground: "#ffffff",
    iconPath: "/provider-icons/openai.svg",
    iconTreatment: "invert",
    modelIdPlaceholder: "如 gpt-5.4-mini",
    models: [
      {
        id: "gpt-5.4-mini",
        capabilities: [...UNIVERSAL_CAPABILITIES, "视觉"],
        description: "当前部署注册的 OpenAI 默认模型",
      },
    ],
  },
  {
    id: "anthropic",
    runtimeProvider: "anthropic",
    group: "native",
    connectionLabel: "原生接入",
    label: "Claude",
    owner: "Anthropic",
    description: "长文本分析、推理与可靠工具调用",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    mark: "AI",
    markBackground: "#f7f1ec",
    markForeground: "#191713",
    iconPath: "/provider-icons/claude-color.svg",
    modelIdPlaceholder: "如 claude-sonnet-4-5",
    models: [
      {
        id: "claude-sonnet-4-5",
        capabilities: [...UNIVERSAL_CAPABILITIES, "视觉"],
        description: "当前部署注册的 Anthropic 默认模型",
      },
    ],
  },
  {
    id: "deepseek",
    runtimeProvider: "deepseek",
    group: "native",
    connectionLabel: "原生接入",
    label: "DeepSeek",
    owner: "DeepSeek",
    description: "面向复杂推理与代码任务的模型服务",
    defaultBaseUrl: "https://api.deepseek.com",
    mark: "DS",
    markBackground: "#e9f0ff",
    markForeground: "#315bd8",
    iconPath: "/provider-icons/deepseek-color.svg",
    modelIdPlaceholder: "如 deepseek-chat",
    models: [
      {
        id: "deepseek-v4-pro",
        capabilities: UNIVERSAL_CAPABILITIES,
        description: "当前部署注册的 DeepSeek 默认模型",
      },
    ],
  },
  {
    id: "glm",
    runtimeProvider: "glm",
    group: "native",
    connectionLabel: "原生接入",
    label: "智谱 GLM",
    owner: "Zhipu AI",
    description: "中文理解、推理与工具调用模型",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    mark: "GL",
    markBackground: "#e9ecff",
    markForeground: "#4a55c9",
    iconPath: "/provider-icons/zhipu-color.svg",
    modelIdPlaceholder: "如 glm-4.5",
    models: [
      {
        id: "glm-5.2",
        capabilities: UNIVERSAL_CAPABILITIES,
        description: "当前部署注册的 GLM 默认模型",
      },
    ],
  },
  {
    id: "kimi",
    runtimeProvider: "kimi",
    group: "native",
    connectionLabel: "原生接入",
    label: "Kimi",
    owner: "Moonshot AI",
    description: "中文长文本、推理与 Agent 任务模型",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    mark: "K",
    markBackground: "#1783ff",
    markForeground: "#ffffff",
    iconPath: "/provider-icons/kimi-color.svg",
    modelIdPlaceholder: "如 kimi-k2-0711-preview",
    models: [
      {
        id: "kimi-k3",
        capabilities: UNIVERSAL_CAPABILITIES,
        description: "当前部署注册的 Kimi 默认模型",
      },
    ],
  },
  {
    id: "grok",
    runtimeProvider: "grok",
    group: "native",
    connectionLabel: "原生接入",
    label: "Grok",
    owner: "xAI",
    description: "实时推理、工具调用与视觉模型",
    defaultBaseUrl: "https://api.x.ai/v1",
    mark: "x",
    markBackground: "#171717",
    markForeground: "#ffffff",
    iconPath: "/provider-icons/grok.svg",
    iconTreatment: "invert",
    modelIdPlaceholder: "如 grok-4-fast-reasoning",
    models: [
      {
        id: "grok-4-fast-reasoning",
        capabilities: [...UNIVERSAL_CAPABILITIES, "视觉"],
        description: "当前部署注册的 Grok 默认模型",
      },
    ],
  },
  {
    id: "gemini",
    runtimeProvider: "gemini",
    group: "native",
    connectionLabel: "原生接入",
    label: "Google Gemini",
    owner: "Google",
    description: "多模态理解、推理与工具调用模型",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    mark: "✦",
    markBackground: "#eef4ff",
    markForeground: "#3f6fd7",
    iconPath: "/provider-icons/gemini-color.svg",
    modelIdPlaceholder: "如 gemini-2.5-flash",
    models: [
      {
        id: "gemini-2.5-flash",
        capabilities: [...UNIVERSAL_CAPABILITIES, "视觉"],
        description: "当前部署注册的 Gemini 默认模型",
      },
    ],
  },
  {
    id: "volcengine",
    runtimeProvider: "openai",
    group: "third-party",
    connectionLabel: "OpenAI 兼容",
    label: "火山引擎",
    owner: "火山方舟",
    description: "通过火山方舟接入豆包及平台部署的模型",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    mark: "火",
    markBackground: "#eef7ff",
    markForeground: "#1f63f5",
    iconPath: "/provider-icons/volcengine-color.svg",
    modelIdPlaceholder: "输入模型或推理接入点 ID",
    models: [],
  },
  {
    id: "siliconflow",
    runtimeProvider: "openai",
    group: "third-party",
    connectionLabel: "OpenAI 兼容",
    label: "硅基流动",
    owner: "SiliconFlow",
    description: "通过统一 API 接入平台提供的开源与商业模型",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    mark: "SF",
    markBackground: "#f5f1ff",
    markForeground: "#6e29f6",
    iconPath: "/provider-icons/siliconcloud-color.svg",
    modelIdPlaceholder: "如 deepseek-ai/DeepSeek-V3",
    models: [],
  },
  {
    id: "openai-compatible",
    runtimeProvider: "openai",
    group: "third-party",
    connectionLabel: "OpenAI 兼容",
    label: "自定义兼容平台",
    owner: "OpenAI-compatible",
    description: "接入其他提供 OpenAI 兼容接口的模型服务",
    defaultBaseUrl: "",
    mark: "API",
    markBackground: "#eef1f5",
    markForeground: "#344054",
    modelIdPlaceholder: "输入平台提供的模型 ID",
    models: [],
  },
] as const satisfies readonly ModelProviderCatalogItem[];

export const MODEL_PROVIDER_PRIORITY: Readonly<Record<ModelVendorId, number>> = Object.freeze({
  deepseek: 1,
  kimi: 2,
  glm: 3,
  openai: 4,
  anthropic: 5,
  siliconflow: 6,
  volcengine: 7,
  grok: 8,
  gemini: 9,
  "openai-compatible": 10,
});

export const ORDERED_MODEL_PROVIDER_CATALOG = Object.freeze(
  [...MODEL_PROVIDER_CATALOG].sort(
    (left, right) => MODEL_PROVIDER_PRIORITY[left.id] - MODEL_PROVIDER_PRIORITY[right.id],
  ),
);

export const NATIVE_MODEL_PROVIDER_CATALOG = MODEL_PROVIDER_CATALOG.filter(
  (item) => item.group === "native",
);

export const THIRD_PARTY_MODEL_PROVIDER_CATALOG = MODEL_PROVIDER_CATALOG.filter(
  (item) => item.group === "third-party",
);

const MODEL_PROVIDER_CATALOG_BY_ID = new Map<ModelVendorId, ModelProviderCatalogItem>(
  MODEL_PROVIDER_CATALOG.map((item) => [item.id, item]),
);

export function getModelProviderCatalogItem(vendorId: ModelVendorId): ModelProviderCatalogItem {
  const item = MODEL_PROVIDER_CATALOG_BY_ID.get(vendorId);
  if (!item) throw new Error(`未注册的模型供应商: ${vendorId}`);
  return item;
}

export function getDefaultModelVendorId(provider: ModelProvider): ModelVendorId {
  return provider;
}
