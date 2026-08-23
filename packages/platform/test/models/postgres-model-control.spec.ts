import { describe, expect, it } from "vitest";
import { createPostgresModelControlRepository } from "../../src/models/postgres-model-control.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";

const ids = {
  deployment: "00000000-0000-4000-8000-00000000de01",
  principal: "00000000-0000-4000-8000-000000001001",
  app: "00000000-0000-4000-8000-00000000da01",
  profile: "00000000-0000-4000-8000-00000000a301",
  connection: "00000000-0000-4000-8000-00000000a303",
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
  provider_connection_id: ids.connection,
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
  status: "ACTIVE",
  config_version: "1",
  is_system_default: false,
  created_by: ids.principal,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
} as const;

const connectionRow = {
  app_id: ids.app,
  environment: "test",
  provider_connection_id: ids.connection,
  vendor_id: "deepseek",
  runtime_provider: "deepseek",
  display_name: "DeepSeek Production",
  base_url: "https://api.deepseek.com/v1",
  credential_ref: null,
  source: "manual",
  status: "ACTIVE",
  health: "untested",
  config_version: "1",
  created_by: ids.principal,
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
} as const;

describe("PostgreSQL model control repository", () => {
  it("records one non-empty model API response without carrying credentials", async () => {
    let observedText = "";
    let observed: readonly unknown[] = [];
    const repository = createPostgresModelControlRepository(
      pool((text, values) => {
        observedText = text;
        observed = values;
        return {
          rows: [
            {
              value: {
                schema_version: "model-certification-view@1.0.0",
                model_profile_id: ids.profile,
                model_config_version: 1,
                provider: "deepseek",
                model_id: "deepseek-v4-flash",
                state: "PASS",
                completed_at: "2026-08-18T00:00:00.000Z",
              },
            },
          ],
          rowCount: 1,
        };
      }),
    );

    const result = await repository.recordModelAuthentication(
      { deployment_id: ids.deployment, principal_id: ids.principal },
      {
        schema_version: "model-api-authentication@1.0.0",
        model_profile_id: ids.profile,
        expected_config_version: 1,
        response_item_count: 2,
        idempotency_key: "model-auth-one",
      },
    );

    expect(result).toMatchObject({ ok: true, value: { state: "PASS" } });
    expect(observedText).toContain("record_model_api_authentication");
    expect(observed.slice(0, 2)).toEqual([ids.deployment, ids.principal]);
    expect(JSON.stringify(observed)).not.toMatch(/api[_-]?key|authorization/iu);
  });

  it("reads a shared database model projection", async () => {
    const repositoryA = createPostgresModelControlRepository(
      pool(() => ({ rows: [row], rowCount: 1 })),
    );
    const repositoryB = createPostgresModelControlRepository(
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
    const repository = createPostgresModelControlRepository(
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
        status: "ACTIVE",
        is_system_default: false,
        expected_config_version: 0,
      },
    );
    expect(result.ok).toBe(true);
    expect(observed.slice(0, 2)).toEqual([ids.deployment, ids.principal]);
    expect(JSON.stringify(observed)).not.toContain("api_key");
  });

  it("maps database permission denial to the stable super-admin error", async () => {
    const repository = createPostgresModelControlRepository(
      pool(() => {
        throw Object.assign(new Error("SUPER_ADMIN_REQUIRED"), { code: "42501" });
      }),
    );
    await expect(
      repository.listModels({ deployment_id: ids.deployment, principal_id: ids.principal }),
    ).resolves.toMatchObject({ ok: false, error: { code: "SUPER_ADMIN_REQUIRED" } });
  });

  it("lists supplier connections and maps database versions to numbers", async () => {
    const repository = createPostgresModelControlRepository(
      pool(() => ({ rows: [connectionRow], rowCount: 1 })),
    );
    await expect(
      repository.listProviderConnections({
        deployment_id: ids.deployment,
        principal_id: ids.principal,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: [{ provider_connection_id: ids.connection, config_version: 1 }],
    });
  });

  it("sends multi-model selection to one security-definer RPC without plaintext credentials", async () => {
    let observedText = "";
    let observed: readonly unknown[] = [];
    const repository = createPostgresModelControlRepository(
      pool((text, values) => {
        observedText = text;
        observed = values;
        return { rows: [{ result: [row] }], rowCount: 1 };
      }),
    );
    const result = await repository.applyProviderSelection(
      { deployment_id: ids.deployment, principal_id: ids.principal },
      {
        schema_version: "model-provider-selection@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "provider-model-selection",
        provider_connection_id: ids.connection,
        expected_connection_version: 1,
        models: [
          {
            model_profile_id: ids.profile,
            model_id: "deepseek-chat",
            display_name: "DeepSeek Chat",
            capabilities: row.capabilities,
            enabled: true,
            expected_config_version: 1,
          },
        ],
      },
    );
    expect(result.ok).toBe(true);
    expect(observedText).toContain("apply_model_provider_selection");
    expect(observed.slice(0, 2)).toEqual([ids.deployment, ids.principal]);
    expect(JSON.stringify(observed)).not.toContain("api_key");
  });

  it("syncs only secret-free environment model metadata through the narrow RPC", async () => {
    let observedText = "";
    let observed: readonly unknown[] = [];
    const repository = createPostgresModelControlRepository(
      pool((text, values) => {
        observedText = text;
        observed = values;
        return { rows: [{ ...row, provider_connection_id: null }], rowCount: 1 };
      }),
    );

    const result = await repository.syncEnvironmentModels(
      { deployment_id: ids.deployment, principal_id: ids.principal },
      {
        schema_version: "environment-model-catalog-sync@1.0.0",
        models: [
          {
            model_profile_id: "30000000-0000-4000-8000-000000000003",
            provider: "deepseek",
            model_id: "deepseek-v4-pro",
            display_name: "DeepSeek 系统模型",
            base_url: "https://api.deepseek.com",
            capabilities: row.capabilities,
            is_system_default: true,
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(observedText).toContain("sync_environment_model_catalog");
    expect(observed.slice(0, 2)).toEqual([ids.deployment, ids.principal]);
    expect(JSON.stringify(observed)).not.toContain("api_key");
    if (!result.ok) throw new Error("Expected environment catalog sync to succeed");
    expect(result.value[0]?.provider_connection_id).toBeUndefined();
  });
});
