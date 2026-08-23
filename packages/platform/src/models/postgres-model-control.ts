import {
  type ArchiveModelProviderConnectionInput,
  archiveModelProviderConnectionInputSchema,
  type ModelCatalogEntry,
  type ModelCatalogStatusInput,
  type ModelCertificationPublicView,
  type ModelProviderConnection,
  type ModelProviderSelectionInput,
  modelCatalogEntrySchema,
  modelCatalogStatusInputSchema,
  modelCertificationPublicViewSchema,
  modelProviderConnectionSchema,
  modelProviderSelectionInputSchema,
  type RecordModelApiAuthenticationInput,
  recordModelApiAuthenticationInputSchema,
  type SyncEnvironmentModelCatalogInput,
  syncEnvironmentModelCatalogInputSchema,
  type UpsertModelCatalogEntryInput,
  type UpsertModelProviderConnectionInput,
  upsertModelCatalogEntryInputSchema,
  upsertModelProviderConnectionInputSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type { SqlClient, SqlPool } from "../persistence/transaction.js";
import { type BoundaryResult, failure } from "../tenancy/capability.js";

const modelControlAdminContextSchema = z.strictObject({
  deployment_id: z.uuid(),
  principal_id: z.uuid(),
});

export type ModelControlAdminContext = z.infer<typeof modelControlAdminContextSchema>;

interface ModelCatalogRow {
  readonly app_id: string;
  readonly environment: string;
  readonly model_profile_id: string;
  readonly provider_connection_id?: string | null;
  readonly provider: ModelCatalogEntry["provider"];
  readonly model_id: string;
  readonly display_name: string;
  readonly base_url: string;
  readonly capabilities: unknown;
  readonly credential_ref: unknown | null;
  readonly status: ModelCatalogEntry["status"];
  readonly config_version: number | string;
  readonly is_system_default: boolean;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly api_authenticated_config_version?: number | string | null;
  readonly api_authenticated_at?: Date | string | null;
  readonly api_authentication_response_count?: number | null;
  readonly api_authentication_idempotency_key?: string | null;
  readonly api_authenticated_by?: string | null;
}

interface ModelProviderConnectionRow {
  readonly app_id: string;
  readonly environment: string;
  readonly provider_connection_id: string;
  readonly vendor_id: ModelProviderConnection["vendor_id"];
  readonly runtime_provider: ModelProviderConnection["runtime_provider"];
  readonly display_name: string;
  readonly base_url: string;
  readonly credential_ref: unknown | null;
  readonly source: ModelProviderConnection["source"];
  readonly status: ModelProviderConnection["status"];
  readonly health: ModelProviderConnection["health"];
  readonly config_version: number | string;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function model(row: ModelCatalogRow): ModelCatalogEntry {
  const {
    provider_connection_id: providerConnectionId,
    api_authenticated_config_version: _authenticatedConfigVersion,
    api_authenticated_at: _authenticatedAt,
    api_authentication_response_count: _responseCount,
    api_authentication_idempotency_key: _idempotencyKey,
    api_authenticated_by: _authenticatedBy,
    ...modelRow
  } = row;
  return modelCatalogEntrySchema.parse({
    schema_version: "model-catalog-entry@1.0.0",
    ...modelRow,
    ...(providerConnectionId ? { provider_connection_id: providerConnectionId } : {}),
    config_version: Number(row.config_version),
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  });
}

function providerConnection(row: ModelProviderConnectionRow): ModelProviderConnection {
  return modelProviderConnectionSchema.parse({
    schema_version: "model-provider-connection@1.0.0",
    ...row,
    config_version: Number(row.config_version),
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  });
}

function isDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["42501", "P0002"].includes(String(error.code))
  );
}

async function withClient<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<BoundaryResult<T>> {
  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return failure("MODEL_CONTROL_UNAVAILABLE", "模型控制面暂时不可用。", true);
  }
  try {
    return { ok: true, value: await operation(client) };
  } catch (error) {
    return isDenied(error)
      ? failure("SUPER_ADMIN_REQUIRED", "只有超级管理员可以访问模型控制面。")
      : failure("MODEL_CONTROL_OPERATION_FAILED", "模型控制面操作失败。", true);
  } finally {
    client.release();
  }
}

export function createPostgresModelControlRepository(pool: SqlPool) {
  function context(input: unknown): BoundaryResult<ModelControlAdminContext> {
    const parsed = modelControlAdminContextSchema.safeParse(input);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : failure("MODEL_CONTROL_ADMIN_CONTEXT_INVALID", "超级管理员 Context 不符合严格契约。");
  }

  return Object.freeze({
    async listActiveModels(input: unknown): Promise<BoundaryResult<readonly ModelCatalogEntry[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ModelCatalogRow>(
          "select * from platform.list_active_model_catalog($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(model));
      });
    },

    async listModels(input: unknown): Promise<BoundaryResult<readonly ModelCatalogEntry[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ModelCatalogRow>(
          "select * from platform.list_model_catalog($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(model));
      });
    },

    async listModelAuthentications(
      input: unknown,
    ): Promise<BoundaryResult<readonly ModelCertificationPublicView[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly value: unknown }>(
          "select platform.list_model_api_authentication_views($1::uuid,$2::uuid) as value",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(
          z.array(modelCertificationPublicViewSchema).parse(result.rows[0]?.value),
        );
      });
    },

    async recordModelAuthentication(
      input: unknown,
      command: RecordModelApiAuthenticationInput,
    ): Promise<BoundaryResult<ModelCertificationPublicView>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedCommand = recordModelApiAuthenticationInputSchema.safeParse(command);
      if (!parsedCommand.success) {
        return failure("MODEL_AUTHENTICATION_INPUT_INVALID", "模型认证输入无效。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly value: unknown }>(
          "select platform.record_model_api_authentication($1::uuid,$2::uuid,$3::jsonb) as value",
          [parsedContext.value.deployment_id, parsedContext.value.principal_id, parsedCommand.data],
        );
        return modelCertificationPublicViewSchema.parse(result.rows[0]?.value);
      });
    },

    async listProviderConnections(
      input: unknown,
    ): Promise<BoundaryResult<readonly ModelProviderConnection[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ModelProviderConnectionRow>(
          "select * from platform.list_model_provider_connections($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(providerConnection));
      });
    },

    async syncEnvironmentModels(
      input: unknown,
      command: SyncEnvironmentModelCatalogInput,
    ): Promise<BoundaryResult<readonly ModelCatalogEntry[]>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedCommand = syncEnvironmentModelCatalogInputSchema.safeParse(command);
      if (!parsedCommand.success) {
        return failure(
          "ENVIRONMENT_MODEL_CATALOG_SYNC_INVALID",
          "环境模型目录同步不符合严格契约。",
        );
      }
      return withClient(pool, async (client) => {
        const result = await client.query<ModelCatalogRow>(
          "select * from platform.sync_environment_model_catalog($1::uuid,$2::uuid,$3::jsonb)",
          [parsedContext.value.deployment_id, parsedContext.value.principal_id, parsedCommand.data],
        );
        return Object.freeze(result.rows.map(model));
      });
    },

    async applyProviderConnectionCommand(
      input: unknown,
      command: UpsertModelProviderConnectionInput | ArchiveModelProviderConnectionInput,
    ): Promise<BoundaryResult<ModelProviderConnection>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedCommand =
        command.schema_version === "model-provider-upsert@1.0.0"
          ? upsertModelProviderConnectionInputSchema.safeParse(command)
          : archiveModelProviderConnectionInputSchema.safeParse(command);
      if (!parsedCommand.success) {
        return failure("MODEL_PROVIDER_COMMAND_INVALID", "供应商连接命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: ModelProviderConnectionRow }>(
          "select app_data_agent.apply_model_provider_connection_command($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsedContext.value.deployment_id, parsedContext.value.principal_id, parsedCommand.data],
        );
        const row = result.rows[0];
        if (!row) throw new Error("MODEL_PROVIDER_RECEIPT_MISSING");
        return providerConnection(row.result);
      });
    },

    async applyProviderSelection(
      input: unknown,
      selection: ModelProviderSelectionInput,
    ): Promise<BoundaryResult<readonly ModelCatalogEntry[]>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedSelection = modelProviderSelectionInputSchema.safeParse(selection);
      if (!parsedSelection.success) {
        return failure("MODEL_PROVIDER_SELECTION_INVALID", "供应商模型选择不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: readonly ModelCatalogRow[] }>(
          "select app_data_agent.apply_model_provider_selection($1::uuid,$2::uuid,$3::jsonb) as result",
          [
            parsedContext.value.deployment_id,
            parsedContext.value.principal_id,
            parsedSelection.data,
          ],
        );
        const rows = result.rows[0]?.result;
        if (!rows) throw new Error("MODEL_PROVIDER_SELECTION_RECEIPT_MISSING");
        return Object.freeze(rows.map(model));
      });
    },

    async applyModelCommand(
      input: unknown,
      command: UpsertModelCatalogEntryInput | ModelCatalogStatusInput,
    ): Promise<BoundaryResult<ModelCatalogEntry>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedCommand =
        command.schema_version === "model-catalog-upsert@1.0.0"
          ? upsertModelCatalogEntryInputSchema.safeParse(command)
          : modelCatalogStatusInputSchema.safeParse(command);
      if (!parsedCommand.success) {
        return failure("MODEL_CATALOG_COMMAND_INVALID", "模型目录命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: ModelCatalogRow }>(
          "select app_data_agent.apply_model_catalog_command($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsedContext.value.deployment_id, parsedContext.value.principal_id, parsedCommand.data],
        );
        const row = result.rows[0];
        if (!row) throw new Error("MODEL_CATALOG_RECEIPT_MISSING");
        return model(row.result);
      });
    },
  });
}
