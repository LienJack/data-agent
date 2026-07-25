import type { CapabilityAuthorizer } from "../tenancy/capability.js";
import { createCacheNamespace, type RedisRestClient } from "./namespace.js";
import { createUpstashRedisRestClientFromEnv } from "./upstash-adapter.js";

function requireAuthorizer(authorizer: CapabilityAuthorizer): CapabilityAuthorizer {
  if (
    !authorizer ||
    typeof authorizer.verify !== "function" ||
    typeof authorizer.requireRole !== "function" ||
    typeof authorizer.revalidate !== "function"
  ) {
    throw new TypeError("CACHE_AUTHORIZER_REQUIRED");
  }
  return authorizer;
}

/**
 * 创建带 App/Tenant/Environment Scope 的 Upstash Cache。
 *
 * 生产环境默认通过 Upstash 环境变量创建 REST Client；测试和本地契约测试可注入
 * RedisRestClient。无论采用哪种 Client，调用方都只能获得 CapabilityAuthorizer
 * 约束后的 Cache Namespace，不能从包根取得 raw Upstash adapter。
 */
export function createScopedUpstashCache(
  authorizer: CapabilityAuthorizer,
  client?: RedisRestClient,
) {
  const requiredAuthorizer = requireAuthorizer(authorizer);
  return createCacheNamespace(client ?? createUpstashRedisRestClientFromEnv(), requiredAuthorizer);
}
