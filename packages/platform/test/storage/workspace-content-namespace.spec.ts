import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StorageClient } from "../../src/storage/namespace.js";
import { createWorkspaceContentNamespace } from "../../src/storage/workspace-content-namespace.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";

const app = "00000000-0000-4000-8000-00000000da01";
const tenant = "10000000-0000-4000-8000-000000000001";
const principal = "20000000-0000-4000-8000-000000000001";
const deployment = "30000000-0000-4000-8000-000000000001";

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: deployment, app_id: app, environment: "local" }],
    [{ subject: principal, deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
  );
  const resolved = registry.resolve({ subject: principal });
  if (!resolved.ok) throw new Error("fixture");
  return { registry, capability: resolved.value };
}

function digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function storageClient() {
  const values = new Map<string, Uint8Array>();
  const client: StorageClient = {
    async put(key, value) {
      values.set(key, value.slice());
    },
    async get(key) {
      return values.get(key)?.slice() ?? null;
    },
    async remove(key) {
      values.delete(key);
    },
    async list(prefix) {
      return [...values.keys()].filter((key) => key.startsWith(prefix));
    },
  };
  return { client, values };
}

describe("U6 workspace content namespace", () => {
  it("derives a versioned content-addressed key and verifies put/get bytes", async () => {
    const storage = storageClient();
    const { registry, capability } = authority();
    const namespace = createWorkspaceContentNamespace(storage.client, registry.authorizer);
    const bytes = new TextEncoder().encode("safe workspace document");
    const hash = digest(bytes);
    const key = namespace.createKey(capability, hash);
    expect(key).toBe(
      `workspace-content/v1/${capability.scope.app_id}/${capability.scope.tenant_id}/local/${hash.slice(7, 9)}/${hash.slice(7)}`,
    );
    await expect(namespace.put(capability, key, bytes, hash)).resolves.toEqual({
      ok: true,
      value: { created: true, key, byte_size: bytes.byteLength, content_hash: hash },
    });
    await expect(namespace.get(capability, key, hash, bytes.byteLength)).resolves.toEqual({
      ok: true,
      value: bytes,
    });
  });

  it("deduplicates equal bytes and rejects object substitution or cross-scope keys", async () => {
    const storage = storageClient();
    const { registry, capability } = authority();
    const namespace = createWorkspaceContentNamespace(storage.client, registry.authorizer);
    const bytes = new TextEncoder().encode("same");
    const hash = digest(bytes);
    const key = namespace.createKey(capability, hash);
    await expect(namespace.put(capability, key, bytes, hash)).resolves.toMatchObject({
      ok: true,
      value: { created: true },
    });
    await expect(namespace.put(capability, key, bytes, hash)).resolves.toMatchObject({
      ok: true,
      value: { created: false },
    });

    storage.values.set(key, new TextEncoder().encode("tampered"));
    await expect(namespace.get(capability, key, hash, bytes.byteLength)).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_FILE_BLOB_INTEGRITY_FAILED" },
    });
    await expect(
      namespace.get(
        capability,
        key.replace(capability.scope.tenant_id, "10000000-0000-4000-8000-000000000002"),
        hash,
        bytes.byteLength,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "STORAGE_KEY_INVALID" } });
  });
});
