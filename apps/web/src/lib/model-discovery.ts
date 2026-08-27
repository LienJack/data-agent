import "server-only";

import net from "node:net";
import { getModelProviderCatalogItem } from "./model-provider-catalog";
import type { DiscoveredProviderModel, DiscoverProviderModelsInput } from "./model-types";

const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 1_000;

type DiscoveryErrorCode =
  | "INVALID_DISCOVERY_URL"
  | "MODEL_DISCOVERY_TIMEOUT"
  | "MODEL_DISCOVERY_FAILED"
  | "INVALID_PROVIDER_RESPONSE";

export class ModelDiscoveryError extends Error {
  constructor(
    readonly code: DiscoveryErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModelDiscoveryError";
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function assertSafeDiscoveryUrl(rawBaseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new ModelDiscoveryError("INVALID_DISCOVERY_URL", "Base URL 格式不正确", 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isPrivateIpv6 =
    net.isIP(hostname) === 6 &&
    (hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8") ||
      hostname.startsWith("fe9") ||
      hostname.startsWith("fea") ||
      hostname.startsWith("feb"));

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIpv4(hostname) ||
    isPrivateIpv6
  ) {
    throw new ModelDiscoveryError(
      "INVALID_DISCOVERY_URL",
      "模型目录只允许访问公开 HTTPS 地址",
      400,
    );
  }

  return url;
}

function resolveModelsUrl(baseUrl: string, vendorId: DiscoverProviderModelsInput["vendorId"]): URL {
  const url = assertSafeDiscoveryUrl(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (vendorId === "deepseek" && url.hostname.toLowerCase() === "api.deepseek.com") {
    url.pathname = "/models";
  } else if (/\/models$/i.test(pathname)) {
    url.pathname = pathname;
  } else if (/\/v\d+(?:beta\d*)?$/i.test(pathname)) {
    url.pathname = `${pathname}/models`;
  } else {
    url.pathname = `${pathname}/v1/models`.replace(/\/{2,}/g, "/");
  }
  url.hash = "";
  return url;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeModel(
  value: unknown,
  vendorId: DiscoverProviderModelsInput["vendorId"],
): DiscoveredProviderModel | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const rawId = stringField(record, "id", "name");
  if (!rawId) return undefined;
  const id = vendorId === "gemini" ? rawId.replace(/^models\//, "") : rawId;
  if (!id || id.length > 256) return undefined;

  const rawDisplayName = stringField(record, "displayName", "display_name") ?? id;
  const rawDescription = stringField(record, "description");
  return {
    id,
    displayName: rawDisplayName.slice(0, 256),
    ...(rawDescription ? { description: rawDescription.slice(0, 500) } : {}),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new ModelDiscoveryError("INVALID_PROVIDER_RESPONSE", "供应商返回的模型目录过大", 502);
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new ModelDiscoveryError("INVALID_PROVIDER_RESPONSE", "供应商返回的模型目录过大", 502);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ModelDiscoveryError(
      "INVALID_PROVIDER_RESPONSE",
      "供应商返回的模型目录格式不正确",
      502,
    );
  }
}

function modelArray(
  payload: unknown,
  vendorId: DiscoverProviderModelsInput["vendorId"],
): unknown[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ModelDiscoveryError(
      "INVALID_PROVIDER_RESPONSE",
      "供应商返回的模型目录格式不正确",
      502,
    );
  }
  const record = payload as Record<string, unknown>;
  const candidate = vendorId === "gemini" ? record.models : record.data;
  if (!Array.isArray(candidate)) {
    throw new ModelDiscoveryError(
      "INVALID_PROVIDER_RESPONSE",
      "供应商返回的模型目录格式不正确",
      502,
    );
  }
  return candidate;
}

export async function fetchProviderModelCatalog(
  input: DiscoverProviderModelsInput,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredProviderModel[]> {
  const vendor = getModelProviderCatalogItem(input.vendorId);
  const modelsUrl = resolveModelsUrl(input.baseUrl, input.vendorId);
  const headers = new Headers({ Accept: "application/json" });

  if (vendor.id === "gemini") {
    modelsUrl.searchParams.set("key", input.apiKey);
    modelsUrl.searchParams.set("pageSize", String(MAX_MODELS));
  } else if (vendor.id === "anthropic") {
    modelsUrl.searchParams.set("limit", String(MAX_MODELS));
    headers.set("x-api-key", input.apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("Authorization", `Bearer ${input.apiKey}`);
  }

  let response: Response;
  try {
    response = await fetchImpl(modelsUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof ModelDiscoveryError) throw error;
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new ModelDiscoveryError(
        "MODEL_DISCOVERY_TIMEOUT",
        "获取模型目录超时，请检查供应商地址后重试",
        504,
      );
    }
    throw new ModelDiscoveryError(
      "MODEL_DISCOVERY_FAILED",
      "无法连接供应商模型目录，请检查 Base URL 与网络",
      502,
    );
  }

  if (!response.ok) {
    throw new ModelDiscoveryError(
      "MODEL_DISCOVERY_FAILED",
      response.status === 401 || response.status === 403
        ? "供应商拒绝访问，请检查 API Key 权限"
        : `供应商模型目录请求失败 (${response.status})`,
      502,
    );
  }

  const payload = await readBoundedJson(response);
  const normalized = modelArray(payload, vendor.id)
    .slice(0, MAX_MODELS)
    .map((model) => normalizeModel(model, vendor.id))
    .filter((model): model is DiscoveredProviderModel => Boolean(model));

  const unique = new Map(normalized.map((model) => [model.id, model]));
  return Array.from(unique.values()).sort((left, right) =>
    left.id.localeCompare(right.id, "en", { numeric: true }),
  );
}
