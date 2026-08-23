import { describe, expect, expectTypeOf, it } from "vitest";
import type { RedisRestClient } from "../../src/cache/namespace.js";
import * as platform from "../../src/index.js";
import {
  type CapabilityAuthorizer,
  createDeploymentRegistry,
} from "../../src/tenancy/capability.js";

const app = "00000000-0000-4000-8000-000000000001";
const tenant = "00000000-0000-4000-8000-000000000011";
const deployment = "00000000-0000-4000-8000-0000000000d1";

function fixture() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: deployment, app_id: app, environment: "prod" }],
    [
      {
        subject: "owner",
        deployment_id: deployment,
        tenant_id: tenant,
        role: "OWNER",
      },
    ],
  );
  const capability = registry.resolve({ subject: "owner" });
  if (!capability.ok) throw new Error("fixture");

  const values = new Map<string, string>();
  const client: RedisRestClient = {
    get: async (key) => values.get(key) ?? null,
    setex: async (key, _ttlSeconds, value) => {
      values.set(key, value);
      return "OK";
    },
    del: async (key) => (values.delete(key) ? 1 : 0),
    scan: async (match) => {
      const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
      return [...values.keys()].filter((key) => key.startsWith(prefix));
    },
  };

  return { registry, capability: capability.value, client };
}

describe("scoped Upstash public factory", () => {
  it("only exports the scoped factory from the package root", () => {
    expect(platform.createScopedUpstashCache).toBeTypeOf("function");
    expect(platform).not.toHaveProperty("createUpstashRedisRestClient");
    expect(platform).not.toHaveProperty("createUpstashRedisRestClientFromEnv");
    expect(platform).not.toHaveProperty("createDeploymentRegistry");
    expect(platform).not.toHaveProperty("createLifecycleEvidenceAuthority");
    expect(platform).not.toHaveProperty("SecretRegistry");
    expect(platform).not.toHaveProperty("createDatasourceEgressPolicyRegistry");
  });

  it("requires a CapabilityAuthorizer and always returns a scoped namespace", async () => {
    expectTypeOf(platform.createScopedUpstashCache)
      .parameter(0)
      .toEqualTypeOf<CapabilityAuthorizer>();

    const { registry, capability, client } = fixture();
    const cache = platform.createScopedUpstashCache(registry.authorizer, client);
    const key = cache.createKey(capability, "projection", "run-1");

    expect(cache.authority).toBe("NON_AUTHORITATIVE");
    expect(await cache.set(capability, key, 30, "cached")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await cache.get(capability, key)).toEqual({
      ok: true,
      value: "cached",
    });

    expect(() =>
      platform.createScopedUpstashCache(undefined as unknown as CapabilityAuthorizer, client),
    ).toThrow("CACHE_AUTHORIZER_REQUIRED");
  });
});
