import { describe, expect, it } from "vitest";
import {
  createLifecycleEvidenceAuthority,
  type LifecycleAction,
  LifecycleRegistry,
} from "../../src/lifecycle/lifecycle.js";
import { createStorageNamespace } from "../../src/storage/namespace.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";

const app = "00000000-0000-4000-8000-000000000001";
const tenant = "00000000-0000-4000-8000-000000000011";
const deployment = "00000000-0000-4000-8000-0000000000d1";
const principal = "00000000-0000-4000-8000-000000000101";
const run = "00000000-0000-4000-8000-000000000201";
const hash = `sha256:${"a".repeat(64)}`;

function evidence(
  authority: ReturnType<typeof createLifecycleEvidenceAuthority>,
  action: Exclude<LifecycleAction, "FREEZE"> | "RESTORE",
  upstream: string | null,
  counts = { database_count: 1, storage_count: 1, redis_count: 1 },
) {
  return authority.issue({
    evidence_id: crypto.randomUUID(),
    app_id: app,
    environment: "prod",
    action,
    upstream_evidence_id: upstream,
    manifest_hash: `sha256:${"b".repeat(64)}`,
    ...counts,
  });
}

describe("lifecycle", () => {
  it("freezes writes, requires a signed effect chain, retires the issuer epoch and restores safely", async () => {
    const registry = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: principal, deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
    );
    const issued = registry.resolve({ subject: principal });
    if (!issued.ok) throw new Error("fixture");

    let writes = 0;
    const storage = createStorageNamespace(
      {
        put: async () => {
          writes += 1;
        },
        get: async () => null,
        remove: async () => {},
        list: async () => [],
      },
      registry.authorizer,
    );
    const key = storage.createKey(
      issued.value,
      { run_id: run, owner_principal_id: principal },
      "artifact",
      hash,
    );
    expect(await storage.put(issued.value, key, new Uint8Array())).toMatchObject({ ok: true });
    expect(writes).toBe(1);

    const evidenceAuthority = createLifecycleEvidenceAuthority();
    const lifecycle = new LifecycleRegistry(
      registry.authorizer,
      registry.lifecycleAuthority,
      evidenceAuthority,
    );
    expect(lifecycle.apply(issued.value, "FREEZE", { forged: true })).toMatchObject({
      ok: false,
      error: { code: "LIFECYCLE_EVIDENCE_UNEXPECTED" },
    });
    expect(await storage.put(issued.value, key, new Uint8Array())).toMatchObject({ ok: true });
    expect(lifecycle.apply(issued.value, "FREEZE")).toMatchObject({
      ok: true,
      value: { state: "FROZEN" },
    });
    expect(await storage.put(issued.value, key, new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "APP_OPERATION_FROZEN" },
    });
    expect(lifecycle.activate(issued.value)).toMatchObject({
      ok: false,
      error: { code: "LIFECYCLE_TRANSITION_DENIED" },
    });
    expect(await storage.put(issued.value, key, new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "APP_OPERATION_FROZEN" },
    });
    expect(writes).toBe(2);

    const enumerated = evidence(evidenceAuthority, "ENUMERATE", null);
    expect(lifecycle.apply(issued.value, "ENUMERATE", enumerated).ok).toBe(true);
    const exported = evidence(evidenceAuthority, "EXPORT_OR_EXPIRE", enumerated.evidence_id);
    expect(lifecycle.apply(issued.value, "EXPORT_OR_EXPIRE", exported).ok).toBe(true);
    const deleted = evidence(evidenceAuthority, "DELETE", exported.evidence_id);
    expect(lifecycle.apply(issued.value, "DELETE", deleted).ok).toBe(true);

    const nonzeroVerify = evidence(evidenceAuthority, "VERIFY", deleted.evidence_id);
    expect(lifecycle.apply(issued.value, "VERIFY", nonzeroVerify)).toMatchObject({
      ok: false,
      error: { code: "LIFECYCLE_RESIDUALS_REMAIN" },
    });
    const zeroVerify = evidence(evidenceAuthority, "VERIFY", deleted.evidence_id, {
      database_count: 0,
      storage_count: 0,
      redis_count: 0,
    });
    expect(lifecycle.apply(issued.value, "VERIFY", zeroVerify)).toMatchObject({
      ok: true,
      value: { state: "RETIRED" },
    });
    expect(registry.authorizer.verify(issued.value)).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_EPOCH_STALE" },
    });

    const restored = evidence(evidenceAuthority, "RESTORE", exported.evidence_id);
    expect(lifecycle.restore(restored)).toMatchObject({
      ok: true,
      value: { state: "RESTORED" },
    });
    const reissued = registry.resolve({ subject: principal });
    if (!reissued.ok) throw new Error("fixture");
    expect(await storage.put(reissued.value, key, new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "APP_OPERATION_FROZEN" },
    });
    expect(lifecycle.activate(reissued.value)).toMatchObject({
      ok: true,
      value: { state: "ACTIVE" },
    });
    expect(await storage.put(reissued.value, key, new Uint8Array())).toMatchObject({ ok: true });
    expect(writes).toBe(3);
  });

  it("rejects viewer transitions and evidence from a different job authority", () => {
    const registry = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: "viewer", deployment_id: deployment, tenant_id: tenant, role: "VIEWER" }],
    );
    const capability = registry.resolve({ subject: "viewer" });
    if (!capability.ok) throw new Error("fixture");
    const evidenceAuthority = createLifecycleEvidenceAuthority();
    const lifecycle = new LifecycleRegistry(
      registry.authorizer,
      registry.lifecycleAuthority,
      evidenceAuthority,
    );
    expect(lifecycle.apply(capability.value, "FREEZE")).toMatchObject({
      ok: false,
      error: { code: "APP_OPERATION_DENIED" },
    });

    const ownerRegistry = createDeploymentRegistry(
      [{ deployment_id: deployment, app_id: app, environment: "prod" }],
      [{ subject: "owner", deployment_id: deployment, tenant_id: tenant, role: "OWNER" }],
    );
    const owner = ownerRegistry.resolve({ subject: "owner" });
    if (!owner.ok) throw new Error("fixture");
    const ownerLifecycle = new LifecycleRegistry(
      ownerRegistry.authorizer,
      ownerRegistry.lifecycleAuthority,
      evidenceAuthority,
    );
    expect(ownerLifecycle.apply(owner.value, "FREEZE").ok).toBe(true);
    const rogueEvidence = evidence(createLifecycleEvidenceAuthority(), "ENUMERATE", null);
    expect(ownerLifecycle.apply(owner.value, "ENUMERATE", rogueEvidence)).toMatchObject({
      ok: false,
      error: { code: "LIFECYCLE_EVIDENCE_AUTHORITY_MISMATCH" },
    });
  });
});
