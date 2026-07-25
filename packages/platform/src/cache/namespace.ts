import {
  type AppCapability,
  type BoundaryResult,
  type CapabilityAuthorizer,
  failure,
} from "../tenancy/capability.js";

const kindPattern = /^[a-z][a-z0-9_-]{1,62}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$/;

export interface RedisRestClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<"OK">;
  del(key: string): Promise<number>;
  scan(match: string): Promise<string[]>;
}

function key(capability: AppCapability, kind: string, identifier: string): string | null {
  return kindPattern.test(kind) && identifierPattern.test(identifier)
    ? `da:${capability.scope.app_id}:${capability.scope.tenant_id}:${
        capability.scope.environment
      }:${kind}:${identifier}`
    : null;
}

function validKey(capability: AppCapability, value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 6 &&
    parts[0] === "da" &&
    parts[1] === capability.scope.app_id &&
    parts[2] === capability.scope.tenant_id &&
    parts[3] === capability.scope.environment &&
    kindPattern.test(parts[4] ?? "") &&
    identifierPattern.test(parts[5] ?? "")
  );
}

export function createCacheNamespace(client: RedisRestClient, authorizer: CapabilityAuthorizer) {
  return {
    authority: "NON_AUTHORITATIVE" as const,

    createKey(capabilityInput: unknown, kind: string, identifier: string): string {
      const capability = authorizer.requireRole(capabilityInput, ["OWNER", "ANALYST", "VIEWER"]);
      if (!capability.ok) throw new TypeError(capability.error.code);
      const value = key(capability.value, kind, identifier);
      if (!value) throw new TypeError("CACHE_KEY_INVALID");
      return value;
    },

    async get(capabilityInput: unknown, value: string): Promise<BoundaryResult<string | null>> {
      const capability = await authorizer.revalidate(capabilityInput, [
        "OWNER",
        "ANALYST",
        "VIEWER",
      ]);
      if (!capability.ok) return capability;
      if (!validKey(capability.value, value)) {
        return failure("CACHE_KEY_INVALID", "Cache Key 不属于当前 Scope。");
      }
      try {
        return { ok: true, value: await client.get(value) };
      } catch {
        return failure("CACHE_UNAVAILABLE", "Cache 暂时不可用；底层错误已脱敏。", true);
      }
    },

    async set(
      capabilityInput: unknown,
      value: string,
      ttlSeconds: number,
      payload: string,
    ): Promise<BoundaryResult<void>> {
      const capability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "WRITE",
      );
      if (!capability.ok) return capability;
      if (
        !validKey(capability.value, value) ||
        !Number.isSafeInteger(ttlSeconds) ||
        ttlSeconds <= 0
      ) {
        return failure("CACHE_KEY_INVALID", "Cache Key 或 TTL 非法。");
      }
      try {
        await client.setex(value, ttlSeconds, payload);
        return { ok: true, value: undefined };
      } catch {
        return failure("CACHE_UNAVAILABLE", "Cache 暂时不可用；底层错误已脱敏。", true);
      }
    },

    async delete(capabilityInput: unknown, value: string): Promise<BoundaryResult<number>> {
      const capability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "WRITE",
      );
      if (!capability.ok) return capability;
      if (!validKey(capability.value, value)) {
        return failure("CACHE_KEY_INVALID", "Cache Key 不属于当前 Scope。");
      }
      try {
        return { ok: true, value: await client.del(value) };
      } catch {
        return failure("CACHE_UNAVAILABLE", "Cache 暂时不可用；底层错误已脱敏。", true);
      }
    },

    async list(capabilityInput: unknown, kind: string): Promise<BoundaryResult<string[]>> {
      const capability = await authorizer.revalidate(capabilityInput, [
        "OWNER",
        "ANALYST",
        "VIEWER",
      ]);
      if (!capability.ok) return capability;
      if (!kindPattern.test(kind)) return failure("CACHE_KEY_INVALID", "Cache Kind 非法。");
      const prefix = `da:${capability.value.scope.app_id}:${capability.value.scope.tenant_id}:${
        capability.value.scope.environment
      }:${kind}:`;
      try {
        const keys = await client.scan(`${prefix}*`);
        return keys.every(
          (value) =>
            value.startsWith(prefix) &&
            validKey(capability.value, value) &&
            value.split(":")[4] === kind,
        )
          ? { ok: true, value: keys }
          : failure("CACHE_CLIENT_SCOPE_BREACH", "底层 Cache 返回了越界 Key。");
      } catch {
        return failure("CACHE_UNAVAILABLE", "Cache 暂时不可用；底层错误已脱敏。", true);
      }
    },
  };
}
