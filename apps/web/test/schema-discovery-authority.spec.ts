import type { AppCapability } from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPostgresSchemaDiscoveryAuthorityResolver } from "../src/lib/schema-discovery-authority";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
} as const;

function capability(overrides: Partial<AppCapability> = {}): AppCapability {
  return {
    scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
    deployment_id: ids.deployment,
    principal: ids.principal,
    role: "OWNER",
    ...overrides,
  };
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as Error & { code: unknown }).code)
    : undefined;
}

function fixture(result: AppCapability = capability()) {
  const resolveForServerContext = vi.fn(async () => ({ ok: true as const, value: result }));
  return {
    resolveForServerContext,
    resolver: createPostgresSchemaDiscoveryAuthorityResolver({
      authority: { resolveForServerContext },
      deploymentId: ids.deployment,
      tenantId: ids.tenant,
      principalId: ids.principal,
    }),
  };
}

describe("server-derived schema discovery authority", () => {
  it("rejects client identity fields before authority resolution", async () => {
    const test = fixture();

    await expect(
      test.resolver.resolve({ access: "WRITE", tenantId: "attacker", principal: "attacker" }),
    ).rejects.toSatisfy((error: unknown) => codeOf(error) === "SCHEMA_SCAN_DATASOURCE_UNAVAILABLE");
    expect(test.resolveForServerContext).not.toHaveBeenCalled();
  });

  it("passes only fixed server identity to PostgreSQL authority", async () => {
    const test = fixture();
    const resolved = await test.resolver.resolve({ access: "WRITE" });

    expect(test.resolveForServerContext).toHaveBeenCalledWith({
      deployment_id: ids.deployment,
      tenant_id: ids.tenant,
      principal_id: ids.principal,
      access: "WRITE",
    });
    expect(resolved).toMatchObject({
      authority: "POSTGRESQL",
      deploymentId: ids.deployment,
      principal: ids.principal,
      scope: { appId: ids.app, tenantId: ids.tenant, environment: "test" },
    });
  });

  it("fails closed when PostgreSQL returns a different server identity", async () => {
    const test = fixture(
      capability({
        scope: {
          app_id: ids.app,
          tenant_id: "00000000-0000-4000-8000-000000000099",
          environment: "test",
        },
      }),
    );

    await expect(test.resolver.resolve({ access: "READ" })).rejects.toSatisfy(
      (error: unknown) => codeOf(error) === "SCHEMA_SCAN_SCOPE_FORBIDDEN",
    );
  });
});
