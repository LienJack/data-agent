import { describe, expect, it } from "vitest";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";

const ids = {
  appA: "00000000-0000-4000-8000-000000000001",
  appB: "00000000-0000-4000-8000-000000000002",
  tenantA: "00000000-0000-4000-8000-000000000011",
  deploymentA: "00000000-0000-4000-8000-0000000000a1",
  deploymentB: "00000000-0000-4000-8000-0000000000b1",
  demoDeployment: "00000000-0000-4000-8000-0000000000d1",
};

describe("deployment capability", () => {
  it("uses only the token subject and observes membership revocation on the next resolve", () => {
    const registry = createDeploymentRegistry(
      [{ deployment_id: ids.deploymentA, app_id: ids.appA, environment: "prod" }],
      [
        {
          subject: "user-1",
          deployment_id: ids.deploymentA,
          tenant_id: ids.tenantA,
          role: "ANALYST",
        },
      ],
    );
    const issued = registry.resolve({
      subject: "user-1",
      app_id: ids.appB,
      tenant_id: ids.tenantA,
      role: "OWNER",
    });
    expect(issued.ok && issued.value.scope.app_id).toBe(ids.appA);
    registry.revoke("user-1", ids.deploymentA);
    expect(issued.ok && registry.authorizer.verify(issued.value)).toMatchObject({
      ok: false,
      error: { code: "MEMBERSHIP_REVOKED" },
    });
    expect(registry.resolve({ subject: "user-1" })).toMatchObject({
      ok: false,
      error: { code: "MEMBERSHIP_REVOKED" },
    });
  });

  it("rejects duplicate registry identities instead of silently overwriting authority", () => {
    expect(() =>
      createDeploymentRegistry(
        [
          { deployment_id: ids.deploymentA, app_id: ids.appA, environment: "prod" },
          { deployment_id: ids.deploymentA, app_id: ids.appB, environment: "prod" },
        ],
        [],
      ),
    ).toThrow("DUPLICATE_DEPLOYMENT_ID");
  });

  it("rejects an environment that cannot be represented by the shared AppScope contract", () => {
    expect(() =>
      createDeploymentRegistry(
        [
          {
            deployment_id: ids.deploymentA,
            app_id: ids.appA,
            environment: `p${"r".repeat(64)}`,
          },
        ],
        [],
      ),
    ).toThrow();
  });

  it("limits demo principals to their registered synthetic dataset and read-only operations", () => {
    const registry = createDeploymentRegistry(
      [{ deployment_id: ids.demoDeployment, app_id: ids.appA, environment: "demo" }],
      [],
      [
        {
          subject: "demo-user",
          deployment_id: ids.demoDeployment,
          tenant_id: ids.tenantA,
          dataset_id: "synthetic-sales",
        },
      ],
    );
    const capability = registry.resolve({ subject: "demo-user" });
    expect(capability.ok && registry.permitsDemo(capability.value, "READ", "synthetic-sales")).toBe(
      true,
    );
    expect(
      capability.ok &&
        registry.permitsDemo(capability.value, "DISCOVER_DATASOURCE", "synthetic-sales"),
    ).toBe(false);
  });

  it("uses a server-selected deployment when one subject belongs to multiple apps", () => {
    const registry = createDeploymentRegistry(
      [
        { deployment_id: ids.deploymentA, app_id: ids.appA, environment: "prod" },
        { deployment_id: ids.deploymentB, app_id: ids.appB, environment: "prod" },
      ],
      [
        {
          subject: "user-2",
          deployment_id: ids.deploymentA,
          tenant_id: ids.tenantA,
          role: "VIEWER",
        },
        {
          subject: "user-2",
          deployment_id: ids.deploymentB,
          tenant_id: ids.tenantA,
          role: "OWNER",
        },
      ],
    );
    expect(registry.resolve({ subject: "user-2" })).toMatchObject({
      ok: false,
      error: { code: "DEPLOYMENT_CONTEXT_REQUIRED" },
    });
    const capability = registry.resolveForDeployment(ids.deploymentB, {
      subject: "user-2",
      app_id: ids.appA,
    });
    expect(capability.ok && capability.value.scope.app_id).toBe(ids.appB);
  });
});
