import type { AppCapability } from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPostgresSemanticAuthorityResolver } from "../src/lib/semantic-authority";

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

function resolver(result: AppCapability = capability()) {
  const resolveForServerContext = vi.fn(async () => ({ ok: true as const, value: result }));
  return {
    resolveForServerContext,
    resolver: createPostgresSemanticAuthorityResolver({
      authority: { resolveForServerContext },
      deploymentId: ids.deployment,
      tenantId: ids.tenant,
      principalId: ids.principal,
      allowedDomains: ["revenue"],
    }),
  };
}

describe("server-derived semantic authority", () => {
  it("rejects client identity fields before authority resolution", async () => {
    const fixture = resolver();
    await expect(
      fixture.resolver.resolve({
        access: "WRITE",
        semanticDomain: "revenue",
        tenantId: "attacker",
        principal: "attacker",
        role: "OWNER",
      }),
    ).rejects.toSatisfy((error: unknown) => codeOf(error) === "SEMANTIC_UNAUTHENTICATED");
    expect(fixture.resolveForServerContext).not.toHaveBeenCalled();
  });

  it("enforces the server allowlist before authority resolution", async () => {
    const fixture = resolver();
    await expect(
      fixture.resolver.resolve({ access: "READ", semanticDomain: "payroll" }),
    ).rejects.toSatisfy((error: unknown) => codeOf(error) === "SEMANTIC_SCOPE_FORBIDDEN");
    expect(fixture.resolveForServerContext).not.toHaveBeenCalled();
  });

  it("allows the all sentinel for reads but never for writes", async () => {
    const fixture = resolver();
    await expect(
      fixture.resolver.resolve({ access: "READ", semanticDomain: "all" }),
    ).resolves.toMatchObject({ scope: { semanticDomain: "all" } });
    await expect(
      fixture.resolver.resolve({ access: "WRITE", semanticDomain: "all" }),
    ).rejects.toSatisfy((error: unknown) => codeOf(error) === "SEMANTIC_SCOPE_FORBIDDEN");
  });

  it("passes only fixed server identity to the authority provider", async () => {
    const fixture = resolver();
    const resolved = await fixture.resolver.resolve({ access: "WRITE", semanticDomain: "revenue" });

    expect(fixture.resolveForServerContext).toHaveBeenCalledWith({
      deployment_id: ids.deployment,
      tenant_id: ids.tenant,
      principal_id: ids.principal,
      access: "WRITE",
    });
    expect(resolved.scope).toEqual({
      appId: ids.app,
      tenantId: ids.tenant,
      environment: "test",
      semanticDomain: "revenue",
    });
  });

  it("fails closed if the authority provider returns a different fixed identity", async () => {
    const fixture = resolver(
      capability({
        scope: {
          app_id: ids.app,
          tenant_id: "00000000-0000-4000-8000-000000000099",
          environment: "test",
        },
      }),
    );

    await expect(
      fixture.resolver.resolve({ access: "READ", semanticDomain: "revenue" }),
    ).rejects.toSatisfy((error: unknown) => codeOf(error) === "SEMANTIC_SCOPE_FORBIDDEN");
  });
});
