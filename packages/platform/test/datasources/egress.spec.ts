import { describe, expect, it } from "vitest";
import { createDatasourceEgressPolicyRegistry } from "../../src/datasources/egress.js";
import {
  createLifecycleEvidenceAuthority,
  LifecycleRegistry,
} from "../../src/lifecycle/lifecycle.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  otherTenant: "00000000-0000-4000-8000-000000000012",
  deployment: "00000000-0000-4000-8000-0000000000d1",
  otherDeployment: "00000000-0000-4000-8000-0000000000d2",
};
const datasourceId = "warehouse-primary";

function fixture() {
  const authority = createDeploymentRegistry(
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
        subject: "owner-b",
        deployment_id: ids.otherDeployment,
        tenant_id: ids.otherTenant,
        role: "OWNER",
      },
    ],
  );
  const owner = authority.resolveForDeployment(ids.deployment, { subject: "owner-a" });
  const otherTenant = authority.resolveForDeployment(ids.otherDeployment, {
    subject: "owner-b",
  });
  if (!owner.ok || !otherTenant.ok) throw new Error("fixture");
  const registry = createDatasourceEgressPolicyRegistry(authority.authorizer);
  const policy = registry.createPolicy(owner.value, {
    datasource_id: datasourceId,
    allowed_hosts: ["data.example.com"],
    allowed_ports: [443],
    allowed_protocols: ["https:"],
  });
  if (!policy.ok) throw new Error("fixture");
  return {
    owner: owner.value,
    otherTenant: otherTenant.value,
    policy: policy.value,
    registry,
    authority,
  };
}

const request = {
  datasource_id: datasourceId,
  url: "https://data.example.com",
};

describe("datasource egress", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "203.0.113.10",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fe80::1",
    "febf::1",
    "::ffff:169.254.169.254",
  ])("blocks non-public address %s", async (address) => {
    const { owner, policy, registry } = fixture();
    const result = await registry.approve(owner, policy, request, {
      resolve: async () => [address],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_ADDRESS_DENIED" },
    });
  });

  it("pins the complete public DNS set and detects rebinding", async () => {
    const { owner, policy, registry } = fixture();
    const sequence = [
      ["8.8.8.8", "1.1.1.1"],
      ["8.8.8.8", "9.9.9.9"],
    ];
    const dns = { resolve: async () => sequence.shift() ?? [] };
    const approved = await registry.approve(owner, policy, request, dns);
    if (!approved.ok) throw new Error("fixture");
    expect(approved.value.pinned_addresses).toEqual(["1.1.1.1", "8.8.8.8"]);
    expect(await registry.verify(owner, approved.value, dns)).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_DNS_REBIND" },
    });
  });

  it("rejects cross-tenant policies, forged approvals and credential-bearing URLs", async () => {
    const { owner, otherTenant, policy, registry } = fixture();
    expect(
      await registry.approve(otherTenant, policy, request, {
        resolve: async () => ["8.8.8.8"],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_POLICY_SCOPE_DENIED" },
    });
    expect(
      await registry.verify(
        owner,
        {
          scope: owner.scope,
          requested_by: owner.principal,
          datasource_id: datasourceId,
          url: "https://data.example.com/",
          host: "data.example.com",
          pinned_addresses: ["8.8.8.8"],
        },
        { resolve: async () => ["8.8.8.8"] },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_EGRESS_APPROVAL_REQUIRED" },
    });
    expect(
      await registry.approve(
        owner,
        policy,
        { datasource_id: datasourceId, url: "https://user:password@data.example.com" },
        { resolve: async () => ["8.8.8.8"] },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_URL_DENIED" },
    });
  });

  it("emits a DNS-free, no-redirect connection target bound to the requester", async () => {
    const { owner, policy, registry } = fixture();
    const approved = await registry.approve(owner, policy, request, {
      resolve: async () => ["8.8.8.8"],
    });
    if (!approved.ok) throw new Error("fixture");
    const verified = await registry.verify(owner, approved.value, {
      resolve: async () => ["8.8.8.8"],
    });
    if (!verified.ok) throw new Error("fixture");
    const observedTargets: unknown[] = [];
    expect(
      await registry.connect(owner, verified.value, {
        async connect(target) {
          observedTargets.push(target);
          return "connected";
        },
      }),
    ).toEqual({
      ok: true,
      value: "connected",
    });
    expect(observedTargets).toEqual([
      {
        scope: owner.scope,
        url: "https://data.example.com/",
        address: "8.8.8.8",
        server_name: "data.example.com",
        redirects: "DENY",
      },
    ]);
    expect(
      await registry.connect(owner, verified.value, {
        connect: async () => "unexpected",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_VERIFIED_APPROVAL_REQUIRED" },
    });
  });

  it("invalidates outstanding approvals when the owner revokes the policy", async () => {
    const { owner, policy, registry } = fixture();
    const approved = await registry.approve(owner, policy, request, {
      resolve: async () => ["8.8.8.8"],
    });
    if (!approved.ok) throw new Error("fixture");
    const verified = await registry.verify(owner, approved.value, {
      resolve: async () => ["8.8.8.8"],
    });
    if (!verified.ok) throw new Error("fixture");
    expect(registry.revokePolicy(owner, policy)).toEqual({ ok: true, value: undefined });
    expect(
      await registry.connect(owner, verified.value, {
        connect: async () => "unexpected",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DATASOURCE_POLICY_REVOKED" },
    });
  });

  it("blocks new egress approvals after app freeze", async () => {
    const { authority, owner, policy, registry } = fixture();
    const lifecycle = new LifecycleRegistry(
      authority.authorizer,
      authority.lifecycleAuthority,
      createLifecycleEvidenceAuthority(),
    );
    expect(lifecycle.apply(owner, "FREEZE").ok).toBe(true);
    expect(
      await registry.approve(owner, policy, request, {
        resolve: async () => ["8.8.8.8"],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "APP_OPERATION_FROZEN" },
    });
  });
});
