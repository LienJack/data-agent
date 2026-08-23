import { describe, expect, it } from "vitest";
import {
  containsPotentialPlaintextSecret,
  redactSecretLog,
  SecretRegistry,
} from "../../src/secrets/secret-ref.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  otherApp: "00000000-0000-4000-8000-000000000002",
  tenant: "00000000-0000-4000-8000-000000000011",
  otherTenant: "00000000-0000-4000-8000-000000000012",
  deployment: "00000000-0000-4000-8000-0000000000d1",
  otherDeployment: "00000000-0000-4000-8000-0000000000d2",
  otherAppDeployment: "00000000-0000-4000-8000-0000000000d3",
};

function authority(appId: string, deploymentId: string, subject: string, tenantId = ids.tenant) {
  const registry = createDeploymentRegistry(
    [{ deployment_id: deploymentId, app_id: appId, environment: "prod" }],
    [
      {
        subject,
        deployment_id: deploymentId,
        tenant_id: tenantId,
        role: "OWNER",
      },
    ],
  );
  const result = registry.resolve({ subject });
  if (!result.ok) throw new Error("fixture");
  return { capability: result.value, authorizer: registry.authorizer };
}

describe("secret references", () => {
  it("uses signed unguessable references and enforces owner/app/version/revocation", () => {
    const ownerRegistry = createDeploymentRegistry(
      [
        { deployment_id: ids.deployment, app_id: ids.app, environment: "prod" },
        { deployment_id: ids.otherDeployment, app_id: ids.app, environment: "prod" },
      ],
      [
        {
          subject: "owner-a",
          deployment_id: ids.deployment,
          tenant_id: ids.tenant,
          role: "OWNER",
        },
        {
          subject: "owner-a",
          deployment_id: ids.otherDeployment,
          tenant_id: ids.otherTenant,
          role: "OWNER",
        },
      ],
    );
    const owner = ownerRegistry.resolveForDeployment(ids.deployment, { subject: "owner-a" });
    const otherTenant = ownerRegistry.resolveForDeployment(ids.otherDeployment, {
      subject: "owner-a",
    });
    if (!owner.ok || !otherTenant.ok) throw new Error("fixture");
    const otherOwner = authority(ids.otherApp, ids.otherAppDeployment, "owner-b");
    const secrets = new SecretRegistry(ownerRegistry.authorizer);
    const created = secrets.create(owner.value, { secret_name: "warehouse" });
    if (!created.ok) throw new Error("fixture");
    expect(created.value.ref).toMatch(/^secretref:[0-9a-f-]{36}$/);

    expect(secrets.resolve(otherOwner.capability, created.value)).toMatchObject({
      ok: false,
      error: { code: "APP_CAPABILITY_ISSUER_MISMATCH" },
    });
    expect(secrets.resolve(otherTenant.value, created.value)).toMatchObject({
      ok: false,
      error: { code: "SECRET_SCOPE_DENIED" },
    });
    expect(secrets.revoke(owner.value, { ...created.value })).toMatchObject({
      ok: false,
      error: { code: "SECRET_REF_REQUIRED" },
    });

    const rotated = secrets.rotate(owner.value, created.value);
    if (!rotated.ok) throw new Error("fixture");
    expect(secrets.resolve(owner.value, created.value)).toMatchObject({
      ok: false,
      error: { code: "SECRET_VERSION_STALE" },
    });
    expect(secrets.revoke(owner.value, rotated.value)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(secrets.resolve(owner.value, rotated.value)).toMatchObject({
      ok: false,
      error: { code: "SECRET_REVOKED" },
    });
  });

  it("redacts nested aliases and naked strings while detecting plaintext payloads", () => {
    const log = redactSecretLog({
      event: "provider-configured",
      value: "plaintext",
      authorization: "Bearer plaintext",
      nested: ["plaintext"],
    });
    expect(log).not.toContain("plaintext");
    expect(redactSecretLog("naked-secret")).toBe('"[REDACTED]"');
    expect(redactSecretLog({ ref: "sk-abcdefghijklmnop" })).not.toContain("sk-abcdefghijklmnop");
    expect(redactSecretLog({ owner_id: "Bearer top-secret" })).not.toContain("top-secret");
    expect(
      containsPotentialPlaintextSecret({
        provider_token: "plaintext",
      }),
    ).toBe(true);
    expect(containsPotentialPlaintextSecret("password=hunter2")).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        secret_ref: "secretref:00000000-0000-4000-8000-000000000001",
      }),
    ).toBe(false);
    expect(
      containsPotentialPlaintextSecret({
        secret_ref: "secretref:sk-plaintext-credential",
      }),
    ).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        secret_refs: ["secretref:00000000-0000-4000-8000-000000000001", "secretref:hunter2"],
      }),
    ).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        datasource: "mysql://reader:plaintext@db.example.com/warehouse",
      }),
    ).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        endpoint: "redis://default:plaintext@cache.example.com:6379",
      }),
    ).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        endpoint: "redis://:plaintext@cache.example.com:6379",
      }),
    ).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        value: `ghp_${"a".repeat(36)}`,
      }),
    ).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        accessKeyId: `AKIA${"A".repeat(16)}`,
        secretAccessKey: "plaintext",
      }),
    ).toBe(true);
    expect(
      containsPotentialPlaintextSecret({
        secret_refs: ["secretref:00000000-0000-4000-8000-000000000001"],
      }),
    ).toBe(false);
    expect(containsPotentialPlaintextSecret({ snapshot_token: "snapshot-1" })).toBe(false);
    expect(containsPotentialPlaintextSecret({ snapshot_token: null })).toBe(false);
    expect(containsPotentialPlaintextSecret({ snapshot_token: "sk-abcdefghijklmnop" })).toBe(true);
  });
});
