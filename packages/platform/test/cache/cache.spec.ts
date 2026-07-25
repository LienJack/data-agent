import { describe, expect, it } from "vitest";
import { createCacheNamespace } from "../../src/cache/namespace.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";

const app = "00000000-0000-4000-8000-000000000001";
const tenant = "00000000-0000-4000-8000-000000000011";
const otherTenant = "00000000-0000-4000-8000-000000000012";
const deployment = "00000000-0000-4000-8000-0000000000d1";
const otherDeployment = "00000000-0000-4000-8000-0000000000d2";
describe("cache namespace", () =>
  it("uses a non-authoritative app/environment key and rejects malformed keys", async () => {
    const registry = createDeploymentRegistry(
      [
        { deployment_id: deployment, app_id: app, environment: "prod" },
        { deployment_id: otherDeployment, app_id: app, environment: "prod" },
      ],
      [
        { subject: "u", deployment_id: deployment, tenant_id: tenant, role: "OWNER" },
        {
          subject: "other",
          deployment_id: otherDeployment,
          tenant_id: otherTenant,
          role: "OWNER",
        },
      ],
    );
    const r = registry.resolve({ subject: "u" });
    if (!r.ok) throw new Error("fixture");
    const cache = createCacheNamespace(
      {
        get: async () => null,
        setex: async () => "OK",
        del: async () => 1,
        scan: async () => [],
      },
      registry.authorizer,
    );
    expect(cache.authority).toBe("NON_AUTHORITATIVE");
    expect(cache.createKey(r.value, "projection", "run-1")).toBe(
      `da:${app}:${tenant}:prod:projection:run-1`,
    );
    expect(await cache.get(r.value, `da:${app}:${tenant}:prod:projection:../x`)).toMatchObject({
      ok: false,
      error: { code: "CACHE_KEY_INVALID" },
    });
    const other = registry.resolve({ subject: "other" });
    if (!other.ok) throw new Error("fixture");
    expect(cache.createKey(other.value, "projection", "run-1")).not.toBe(
      cache.createKey(r.value, "projection", "run-1"),
    );
    const rogue = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: "rogue", deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
    );
    const rogueCapability = rogue.resolve({ subject: "rogue" });
    if (!rogueCapability.ok) throw new Error("fixture");
    expect(() => cache.createKey(rogueCapability.value, "projection", "run-1")).toThrow(
      "APP_CAPABILITY_ISSUER_MISMATCH",
    );
  }));

describe("cache adapter failures", () =>
  it("returns a retryable sanitized boundary error", async () => {
    const registry = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: "u", deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
    );
    const capability = registry.resolve({ subject: "u" });
    if (!capability.ok) throw new Error("fixture");
    const cache = createCacheNamespace(
      {
        get: async () => {
          throw new Error("https://secret-upstash-endpoint.invalid");
        },
        setex: async () => {
          throw new Error("https://secret-upstash-endpoint.invalid");
        },
        del: async () => {
          throw new Error("https://secret-upstash-endpoint.invalid");
        },
        scan: async () => {
          throw new Error("https://secret-upstash-endpoint.invalid");
        },
      },
      registry.authorizer,
    );
    const key = cache.createKey(capability.value, "projection", "run-1");
    const result = await cache.get(capability.value, key);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CACHE_UNAVAILABLE", retryable: true },
    });
    expect(JSON.stringify(result)).not.toContain("secret-upstash-endpoint");
  }));
