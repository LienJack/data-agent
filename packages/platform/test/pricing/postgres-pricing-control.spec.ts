import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresPricingControlRepository } from "../../src/pricing/postgres-pricing-control.js";

const ids = {
  deployment: "00000000-0000-4000-8000-00000000de01",
  principal: "00000000-0000-4000-8000-000000001001",
  app: "00000000-0000-4000-8000-00000000da01",
  profile: "00000000-0000-4000-8000-00000000a301",
  operation: "00000000-0000-4000-8000-00000000a302",
} as const;

function pool(handler: (text: string, values: readonly unknown[]) => SqlQueryResult): SqlPool {
  return {
    async connect() {
      return {
        async query<Row extends object>(text: string, values: readonly unknown[] = []) {
          return handler(text, values) as SqlQueryResult<Row>;
        },
        release() {},
      } satisfies SqlClient;
    },
  };
}

const row = {
  app_id: ids.app,
  environment: "test",
  model_profile_id: ids.profile,
  provider: "openai",
  model_id: "gpt-example",
  display_name: "GPT Example",
  base_url: "https://api.openai.com/v1",
  capabilities: {
    structured_output: true,
    tool_calling: true,
    streaming: true,
    reasoning: true,
    vision: false,
  },
  credential_ref: null,
  status: "UNBILLABLE",
  config_version: "1",
  is_system_default: false,
  created_by: ids.principal,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
} as const;

describe("PostgreSQL pricing control repository", () => {
  it("reads a shared database model projection", async () => {
    const repositoryA = createPostgresPricingControlRepository(
      pool(() => ({ rows: [row], rowCount: 1 })),
    );
    const repositoryB = createPostgresPricingControlRepository(
      pool(() => ({ rows: [row], rowCount: 1 })),
    );
    const context = { deployment_id: ids.deployment, principal_id: ids.principal };
    await expect(repositoryA.listModels(context)).resolves.toMatchObject({
      ok: true,
      value: [{ model_profile_id: ids.profile, config_version: 1 }],
    });
    await expect(repositoryB.listModels(context)).resolves.toMatchObject({
      ok: true,
      value: [{ model_profile_id: ids.profile }],
    });
  });

  it("passes only deployment, principal and strict command to the security-definer RPC", async () => {
    let observed: readonly unknown[] = [];
    const repository = createPostgresPricingControlRepository(
      pool((_text, values) => {
        observed = values;
        return { rows: [{ result: row }], rowCount: 1 };
      }),
    );
    const result = await repository.applyModelCommand(
      { deployment_id: ids.deployment, principal_id: ids.principal },
      {
        schema_version: "model-catalog-upsert@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "model-upsert-one",
        model_profile_id: ids.profile,
        provider: "openai",
        model_id: "gpt-example",
        display_name: "GPT Example",
        base_url: "https://api.openai.com/v1",
        capabilities: row.capabilities,
        credential_ref: null,
        status: "UNBILLABLE",
        is_system_default: false,
        expected_config_version: 0,
      },
    );
    expect(result.ok).toBe(true);
    expect(observed.slice(0, 2)).toEqual([ids.deployment, ids.principal]);
    expect(JSON.stringify(observed)).not.toContain("api_key");
  });

  it("maps database permission denial to the stable super-admin error", async () => {
    const repository = createPostgresPricingControlRepository(
      pool(() => {
        throw Object.assign(new Error("SUPER_ADMIN_REQUIRED"), { code: "42501" });
      }),
    );
    await expect(
      repository.listModels({ deployment_id: ids.deployment, principal_id: ids.principal }),
    ).resolves.toMatchObject({ ok: false, error: { code: "SUPER_ADMIN_REQUIRED" } });
  });
});
