import { describe, expect, it } from "vitest";
import { createStorageNamespace } from "../../src/storage/namespace.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";

const app = "00000000-0000-4000-8000-000000000001";
const tenant = "00000000-0000-4000-8000-000000000011";
const deployment = "00000000-0000-4000-8000-0000000000d1";
const principal = "00000000-0000-4000-8000-000000000101";
const run = "00000000-0000-4000-8000-000000000201";
const runBinding = { run_id: run, owner_principal_id: principal };
const digest = `sha256:${"a".repeat(64)}`;
describe("storage namespace", () =>
  it("rejects traversal and cross-scope keys before the client", async () => {
    const registry = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: principal, deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
    );
    const capability = registry.resolve({ subject: principal });
    if (!capability.ok) throw new Error("fixture");
    let calls = 0;
    const storage = createStorageNamespace(
      {
        put: async () => {
          calls += 1;
        },
        get: async () => null,
        remove: async () => {},
        list: async () => [],
      },
      registry.authorizer,
    );
    const key = storage.createKey(capability.value, runBinding, "artifact", digest);
    expect(key).toBe(`${app}/${tenant}/prod/${principal}/${run}/artifact/sha256-${"a".repeat(64)}`);
    expect(
      await storage.put(
        capability.value,
        `${app}/${tenant}/prod/${principal}/../artifact/sha256-${"a".repeat(64)}`,
        new Uint8Array(),
      ),
    ).toMatchObject({ ok: false, error: { code: "STORAGE_KEY_INVALID" } });
    expect(
      await storage.put({ scope: capability.value.scope, role: "OWNER" }, key, new Uint8Array()),
    ).toMatchObject({ ok: false, error: { code: "APP_CAPABILITY_REQUIRED" } });
    expect(calls).toBe(0);
    const rogueDeployment = "00000000-0000-4000-8000-0000000000d2";
    const rogue = createDeploymentRegistry(
      [{ deployment_id: rogueDeployment, app_id: app, environment: "prod" }],
      [
        {
          subject: "attacker",
          deployment_id: rogueDeployment,
          tenant_id: tenant,
          role: "OWNER",
        },
      ],
    );
    const rogueCapability = rogue.resolve({ subject: "attacker" });
    if (!rogueCapability.ok) throw new Error("fixture");
    expect(await storage.put(rogueCapability.value, key, new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "APP_CAPABILITY_ISSUER_MISMATCH" },
    });
    expect(calls).toBe(0);
    registry.revoke(principal, deployment);
    expect(await storage.put(capability.value, key, new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "MEMBERSHIP_REVOKED" },
    });
    expect(calls).toBe(0);
  }));

describe("storage environment isolation", () =>
  it("keeps prod and staging separate on one shared client", async () => {
    const objects = new Map<string, Uint8Array>();
    const client = {
      async put(key: string, value: Uint8Array) {
        objects.set(key, value);
      },
      async get(key: string) {
        return objects.get(key) ?? null;
      },
      async remove(key: string) {
        objects.delete(key);
      },
      async list(prefix: string) {
        return [...objects.keys()].filter((key) => key.startsWith(prefix));
      },
    };
    const prod = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: principal, deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
    );
    const stagingDeployment = "00000000-0000-4000-8000-0000000000d2";
    const staging = createDeploymentRegistry(
      [{ deployment_id: stagingDeployment, app_id: app, environment: "staging" }],
      [
        {
          subject: principal,
          deployment_id: stagingDeployment,
          tenant_id: tenant,
          role: "OWNER",
        },
      ],
    );
    const prodCapability = prod.resolve({ subject: principal });
    const stagingCapability = staging.resolve({ subject: principal });
    if (!prodCapability.ok || !stagingCapability.ok) throw new Error("fixture");
    const prodStorage = createStorageNamespace(client, prod.authorizer);
    const stagingStorage = createStorageNamespace(client, staging.authorizer);
    const prodKey = prodStorage.createKey(prodCapability.value, runBinding, "artifact", digest);
    const stagingKey = stagingStorage.createKey(
      stagingCapability.value,
      runBinding,
      "artifact",
      digest,
    );

    expect(prodKey).not.toBe(stagingKey);
    expect(await prodStorage.put(prodCapability.value, prodKey, new Uint8Array([1]))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await stagingStorage.get(stagingCapability.value, prodKey)).toMatchObject({
      ok: false,
      error: { code: "STORAGE_KEY_INVALID" },
    });
    expect(await stagingStorage.get(stagingCapability.value, stagingKey)).toEqual({
      ok: true,
      value: null,
    });
  }));

describe("storage principal and run isolation", () =>
  it("rejects a non-owner path bound to another principal", async () => {
    const analystDeployment = "00000000-0000-4000-8000-0000000000d3";
    const analyst = "00000000-0000-4000-8000-000000000102";
    const registry = createDeploymentRegistry(
      [{ deployment_id: analystDeployment, app_id: app, environment: "prod" }],
      [
        {
          subject: analyst,
          deployment_id: analystDeployment,
          tenant_id: tenant,
          role: "ANALYST",
        },
      ],
    );
    const capability = registry.resolve({ subject: analyst });
    if (!capability.ok) throw new Error("fixture");
    let calls = 0;
    const storage = createStorageNamespace(
      {
        put: async () => {
          calls += 1;
        },
        get: async () => {
          calls += 1;
          return null;
        },
        remove: async () => {
          calls += 1;
        },
        list: async () => {
          calls += 1;
          return [];
        },
      },
      registry.authorizer,
    );
    expect(() => storage.createKey(capability.value, runBinding, "artifact", digest)).toThrow(
      "STORAGE_KEY_INVALID",
    );
    const ownerKey = `${app}/${tenant}/prod/${principal}/${run}/artifact/sha256-${"a".repeat(64)}`;
    expect(await storage.get(capability.value, ownerKey)).toMatchObject({
      ok: false,
      error: { code: "STORAGE_KEY_INVALID" },
    });
    expect(await storage.list(capability.value, runBinding, "artifact")).toMatchObject({
      ok: false,
      error: { code: "STORAGE_KEY_INVALID" },
    });
    expect(calls).toBe(0);
  }));

describe("storage adapter failures", () =>
  it("returns a retryable sanitized boundary error", async () => {
    const registry = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: principal, deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
    );
    const capability = registry.resolve({ subject: principal });
    if (!capability.ok) throw new Error("fixture");
    const storage = createStorageNamespace(
      {
        put: async () => {
          throw new Error("https://secret-storage-endpoint.invalid");
        },
        get: async () => {
          throw new Error("https://secret-storage-endpoint.invalid");
        },
        remove: async () => {
          throw new Error("https://secret-storage-endpoint.invalid");
        },
        list: async () => {
          throw new Error("https://secret-storage-endpoint.invalid");
        },
      },
      registry.authorizer,
    );
    const key = storage.createKey(capability.value, runBinding, "artifact", digest);
    const result = await storage.get(capability.value, key);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORAGE_UNAVAILABLE", retryable: true },
    });
    expect(JSON.stringify(result)).not.toContain("secret-storage-endpoint");
  }));
