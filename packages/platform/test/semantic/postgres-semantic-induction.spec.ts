import { buildSemanticInductionSourceRegistrationCommand } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticInductionRegistry } from "../../src/semantic/postgres-semantic-induction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  deployment: "00000000-0000-4000-8000-0000000000d1",
  source: "00000000-0000-4000-8000-000000000201",
} as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const capability = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function poolWith(value: unknown) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      if (text.includes("register_semantic_induction_source")) {
        return { rows: [{ value }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

describe("PostgreSQL semantic induction registry", () => {
  it("registers only the canonical package content and verifies the returned ref", async () => {
    const auth = authority();
    const command = await buildSemanticInductionSourceRegistrationCommand({
      schema_version: "semantic-induction-source-register@1.0.0",
      scope: auth.capability.scope,
      semantic_domain: "commerce",
      source_kind: "METRIC_EXCHANGE",
      resource_id: ids.source,
      resource_revision: 1,
      content: {
        metric_format: "OSI_METRIC_EXCHANGE",
        facts: [],
        metrics: [
          { external_id: "gmv", name: "Gross Revenue", expression: "sum(amount)", unit: "CNY" },
        ],
        dependencies: [],
      },
    });
    const scripted = poolWith(command.source.source_ref);
    const registry = createPostgresSemanticInductionRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(registry.registerSource(auth.capability, command)).resolves.toEqual({
      ok: true,
      value: command.source.source_ref,
    });
    expect(
      scripted.calls.find(({ text }) => text.includes("register_semantic_induction_source"))
        ?.values,
    ).toEqual([command.semantic_domain, command.source, command.content]);
  });

  it("rejects a caller-tampered source hash before opening a DB transaction", async () => {
    const auth = authority();
    const command = await buildSemanticInductionSourceRegistrationCommand({
      schema_version: "semantic-induction-source-register@1.0.0",
      scope: auth.capability.scope,
      semantic_domain: "commerce",
      source_kind: "FOUNDATIONAL_ONTOLOGY",
      resource_id: ids.source,
      resource_revision: 1,
      content: {
        metric_format: null,
        facts: [
          {
            namespace: "commerce",
            object_role: "ONTOLOGY_ALIGNMENT",
            name: "Commerce alignment",
            aliases: [],
            mapping_identities: ["ontology:commerce"],
            evidence_identities: ["release:commerce-v1"],
            payload: { relation: "aligns_with" },
          },
        ],
        metrics: [],
        dependencies: [],
      },
    });
    const scripted = poolWith(command.source.source_ref);
    const registry = createPostgresSemanticInductionRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    const result = await registry.registerSource(auth.capability, {
      ...command,
      request_hash: `sha256:${"0".repeat(64)}`,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_INDUCTION_SOURCE_INVALID" },
    });
    expect(scripted.calls).toEqual([]);
  });
});
