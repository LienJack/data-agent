import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSchemaDiscoveryDatasourceResolver } from "../src/lib/schema-discovery-datasource";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  credential: "00000000-0000-4000-8000-000000000005",
  secret: "00000000-0000-4000-8000-000000000006",
} as const;
const authority = {
  authority: "POSTGRESQL" as const,
  capabilityInput: { server: "capability" },
  scope: { appId: ids.app, tenantId: ids.tenant, environment: "test" },
  deploymentId: ids.deployment,
  principal: ids.principal,
};

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "schema-discovery-datasource-metadata@1.0.0",
    datasource_id: "warehouse-primary",
    type: "postgresql",
    host: "warehouse.internal",
    port: 5432,
    database: "warehouse",
    username: "catalog_reader",
    ssl: "verify-full",
    credential_ref: {
      schema_version: "datasource-credential-ref@1.0.0",
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      credential_ref_id: ids.credential,
      secret_ref_id: ids.secret,
      secret_version: 7,
      rotation_state: "ACTIVE",
    },
    ...overrides,
  };
}

function fixture(metadataValue: unknown = metadata()) {
  const calls: string[] = [];
  const connector = { connect: vi.fn() };
  const metadataResolver = {
    resolve: vi.fn(async () => {
      calls.push("metadata");
      return metadataValue;
    }),
  };
  const egressAuthorizer = {
    authorize: vi.fn(async () => {
      calls.push("egress");
      return {
        address: "203.0.113.10",
        port: 5432,
        server_name: "warehouse.internal",
        protocol: "postgresql:" as const,
        redirects: "DENY" as const,
      };
    }),
  };
  const secretResolver = {
    resolve: vi.fn(async () => {
      calls.push("secret");
      return { username: "short_lived_reader", secret_value: "raw-short-lived-secret" };
    }),
  };
  const connectorFactory = {
    create: vi.fn(() => {
      calls.push("connector");
      return connector;
    }),
  };
  return {
    calls,
    connector,
    metadataResolver,
    egressAuthorizer,
    secretResolver,
    connectorFactory,
    resolver: createSchemaDiscoveryDatasourceResolver({
      metadataResolver,
      egressAuthorizer,
      secretResolver,
      connectorFactory,
    }),
  };
}

describe("schema discovery datasource composition", () => {
  it("authorizes egress before resolving a short-lived SecretRef credential", async () => {
    const test = fixture();
    const result = await test.resolver.resolve("warehouse-primary", authority);

    expect(test.calls).toEqual(["metadata", "egress", "secret", "connector"]);
    expect(test.egressAuthorizer.authorize).toHaveBeenCalledWith(
      {
        datasource_id: "warehouse-primary",
        host: "warehouse.internal",
        port: 5432,
        protocol: "postgresql:",
      },
      authority,
    );
    expect(test.secretResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ secret_ref_id: ids.secret, secret_version: 7 }),
      authority,
    );
    expect(test.connectorFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        datasource_id: "warehouse-primary",
        database: "warehouse",
        username: "short_lived_reader",
        secret_value: "raw-short-lived-secret",
      }),
    );
    expect(result.connector).toBe(test.connector);
    expect(result.datasource_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain("raw-short-lived-secret");
  });

  it("rejects cross-scope, inactive and unknown metadata before egress or secret access", async () => {
    for (const unsafe of [
      metadata({
        credential_ref: {
          ...metadata().credential_ref,
          tenant_id: "00000000-0000-4000-8000-000000000099",
        },
      }),
      metadata({
        credential_ref: { ...metadata().credential_ref, rotation_state: "REVOKED" },
      }),
      { ...metadata(), password: "raw-secret" },
    ]) {
      const test = fixture(unsafe);

      await expect(test.resolver.resolve("warehouse-primary", authority)).rejects.toBeInstanceOf(
        Error,
      );
      expect(test.egressAuthorizer.authorize).not.toHaveBeenCalled();
      expect(test.secretResolver.resolve).not.toHaveBeenCalled();
      expect(test.connectorFactory.create).not.toHaveBeenCalled();
    }
  });

  it("binds the fingerprint to the credential reference version without hashing the secret", async () => {
    const first = fixture();
    const second = fixture(
      metadata({ credential_ref: { ...metadata().credential_ref, secret_version: 8 } }),
    );

    const firstResult = await first.resolver.resolve("warehouse-primary", authority);
    const secondResult = await second.resolver.resolve("warehouse-primary", authority);

    expect(secondResult.datasource_fingerprint).not.toBe(firstResult.datasource_fingerprint);
    expect(firstResult.datasource_fingerprint).not.toContain("raw-short-lived-secret");
  });

  it("rejects a pinned egress target that is rebound to another server name", async () => {
    const test = fixture();
    test.egressAuthorizer.authorize.mockResolvedValueOnce({
      address: "203.0.113.99",
      port: 5432,
      server_name: "attacker.internal",
      protocol: "postgresql:",
      redirects: "DENY",
    });

    await expect(test.resolver.resolve("warehouse-primary", authority)).rejects.toBeInstanceOf(
      Error,
    );
    expect(test.secretResolver.resolve).not.toHaveBeenCalled();
    expect(test.connectorFactory.create).not.toHaveBeenCalled();
  });
});
