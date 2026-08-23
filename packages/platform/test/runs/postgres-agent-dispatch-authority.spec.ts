import { buildSubagentCapabilityCatalogSnapshot } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresAgentDispatchAuthority } from "../../src/runs/postgres-agent-dispatch-authority.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = { app: id(1), tenant: id(2), owner: id(3), analyst: id(4), deployment: id(5) };

function authorities() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      { subject: ids.owner, deployment_id: ids.deployment, tenant_id: ids.tenant, role: "OWNER" },
      {
        subject: ids.analyst,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const owner = registry.resolveForDeployment(ids.deployment, { subject: ids.owner });
  const analyst = registry.resolveForDeployment(ids.deployment, { subject: ids.analyst });
  if (!owner.ok || !analyst.ok) throw new Error("authority fixture failed");
  return {
    owner: owner.value,
    analyst: analyst.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(handler: (text: string) => SqlQueryResult | undefined) {
  const calls: string[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string) {
      calls.push(text);
      const result = handler(text);
      if (result) return result as SqlQueryResult<Row>;
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

describe("PostgreSQL Agent dispatch authority", () => {
  it("allows only Owner to change the versioned rollout policy", async () => {
    const { owner, analyst, authorizer } = authorities();
    const { calls, pool } = scriptedPool((text) =>
      text.includes("set_agent_dispatch_rollout_policy")
        ? {
            rows: [
              {
                value: {
                  schema_version: "agent-dispatch-rollout-policy@1.0.0",
                  mode: "ENFORCED",
                  version: 2,
                  policy_version: "adaptive-routing@1.0.0+rollout.2",
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const authority = createPostgresAgentDispatchAuthority({ pool, authorizer });

    await expect(
      authority.setRolloutPolicy(owner, { mode: "ENFORCED", expected_version: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      value: { mode: "ENFORCED", version: 2, policy_version: "adaptive-routing@1.0.0+rollout.2" },
    });
    const callsBeforeAnalyst = calls.length;
    await expect(
      authority.setRolloutPolicy(analyst, { mode: "SHADOW", expected_version: 2 }),
    ).resolves.toMatchObject({ ok: false });
    expect(calls.slice(callsBeforeAnalyst)).toEqual([]);
  });

  it("loads the exact principal-scoped frozen catalog snapshot", async () => {
    const { analyst, authorizer } = authorities();
    const runId = id(20);
    const catalogId = id(21);
    const snapshot = await buildSubagentCapabilityCatalogSnapshot({
      schema_version: "subagent-capability-catalog-snapshot@1.0.0",
      catalog_id: catalogId,
      scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
      run_id: runId,
      principal_id: ids.analyst,
      policy_version: "adaptive-routing@1.0.0+rollout.1",
      items: [],
    });
    const { calls, pool } = scriptedPool((text) =>
      text.includes("load_subagent_catalog_snapshot")
        ? { rows: [{ value: snapshot }], rowCount: 1 }
        : undefined,
    );
    const authority = createPostgresAgentDispatchAuthority({ pool, authorizer });

    await expect(
      authority.loadCatalogSnapshot(analyst, { run_id: runId, catalog_id: catalogId }),
    ).resolves.toMatchObject({ ok: true, value: { snapshot_hash: snapshot.snapshot_hash } });
    expect(calls.some((call) => call.includes("load_subagent_catalog_snapshot"))).toBe(true);
  });
});
