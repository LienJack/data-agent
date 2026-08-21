import { randomUUID } from "node:crypto";
import {
  appendWorkspaceConversationMessageInputSchema,
  bindWorkspaceConversationDatasourceInputSchema,
  bindWorkspaceRunInputSchema,
  buildWorkspaceConversationDirectoryCommand,
  type ConversationTrashRetentionClaim,
  type ConversationTrashRetentionReceipt,
  conversationTrashRetentionClaimInputSchema,
  conversationTrashRetentionClaimSchema,
  conversationTrashRetentionCompleteInputSchema,
  conversationTrashRetentionReceiptSchema,
  createWorkspaceConversationInputSchema,
  createWorkspaceDatasourceInputSchema,
  type PortResult,
  type QaConversationResourceSwitchResult,
  qaConversationResourceSwitchInputSchema,
  qaConversationResourceSwitchResultSchema,
  updateWorkspaceConversationModelInputSchema,
  verifyWorkspaceConversationDirectoryCommand,
  type WorkspaceConversation,
  type WorkspaceConversationDirectoryCommandResult,
  type WorkspaceConversationDirectoryPage,
  type WorkspaceConversationMessage,
  type WorkspaceDatasource,
  type WorkspaceRunBinding,
  workspaceConversationDirectoryCommandResultSchema,
  workspaceConversationDirectoryPageSchema,
  workspaceConversationDirectoryQuerySchema,
  workspaceConversationMessageSchema,
  workspaceConversationSchema,
  workspaceDatasourceSchema,
  workspaceRunBindingSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";
import { PersistenceBoundaryError, type SqlPool, withAppTransaction } from "./transaction.js";

const idInputSchema = z.strictObject({ id: z.uuid() });

interface DatasourceRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly datasource_id: string;
  readonly resource_version: string | number;
  readonly name: string;
  readonly datasource_type: WorkspaceDatasource["type"];
  readonly host: string | null;
  readonly port: number | null;
  readonly database_name: string | null;
  readonly username: string | null;
  readonly credential_ref_id: string | null;
  readonly secret_ref_id: string | null;
  readonly secret_version: string | number | null;
  readonly rotation_state: WorkspaceDatasource["credential_ref"] extends infer Credential
    ? Credential extends { rotation_state: infer State }
      ? State | null
      : null
    : null;
  readonly ssl_mode: WorkspaceDatasource["ssl"];
  readonly file_path: string | null;
  readonly catalog_name: string | null;
  readonly schema_name: string | null;
  readonly status: WorkspaceDatasource["status"];
  readonly last_tested_at: Date | string | null;
  readonly created_by_principal_id: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ConversationRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly conversation_id: string;
  readonly owner_principal_id: string;
  readonly title: string;
  readonly datasource_id: string | null;
  readonly model_id: string | null;
  readonly model_profile_id: string | null;
  readonly resource_version: string | number;
  readonly message_count: string | number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface MessageRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly conversation_id: string;
  readonly message_id: string;
  readonly role: WorkspaceConversationMessage["role"];
  readonly content: string;
  readonly message_type: WorkspaceConversationMessage["type"];
  readonly run_id: string | null;
  readonly metadata: unknown;
  readonly created_at: Date | string;
}

interface RunBindingRow {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
  readonly run_id: string;
  readonly datasource_id: string;
  readonly conversation_id: string | null;
  readonly principal_id: string;
  readonly created_at: Date | string;
}

const datasourceColumns = `
  app_id, tenant_id, environment, datasource_id, resource_version, name, datasource_type,
  host, port, database_name, username, credential_ref_id, secret_ref_id,
  secret_version, rotation_state, ssl_mode, file_path, catalog_name, schema_name,
  status, last_tested_at, created_by_principal_id, created_at, updated_at`;

const conversationColumns = `
  conversation.app_id, conversation.tenant_id, conversation.environment,
  conversation.conversation_id, conversation.owner_principal_id, conversation.title,
  conversation.datasource_id, conversation.model_id, conversation.model_profile_id,
  conversation.resource_version, conversation.created_at,
  conversation.updated_at,
  (select pg_catalog.count(*) from qa_messages as message
   where message.app_id = conversation.app_id
     and message.tenant_id = conversation.tenant_id
     and message.environment = conversation.environment
     and message.conversation_id = conversation.conversation_id) as message_count`;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function invalid<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

function requireRow<Row>(row: Row | undefined, code: string, message: string): Row {
  if (row === undefined) throw new PersistenceBoundaryError(code, message);
  return row;
}

function datasource(row: DatasourceRow): WorkspaceDatasource {
  const credentialRef =
    row.credential_ref_id && row.secret_ref_id && row.secret_version && row.rotation_state
      ? {
          schema_version: "datasource-credential-ref@1.0.0" as const,
          app_id: row.app_id,
          tenant_id: row.tenant_id,
          environment: row.environment,
          credential_ref_id: row.credential_ref_id,
          secret_ref_id: row.secret_ref_id,
          secret_version: Number(row.secret_version),
          rotation_state: row.rotation_state,
        }
      : null;
  return workspaceDatasourceSchema.parse({
    schema_version: "workspace-datasource@1.0.0",
    workspace_id: row.tenant_id,
    datasource_id: row.datasource_id,
    resource_version: Number(row.resource_version),
    name: row.name,
    type: row.datasource_type,
    host: row.host,
    port: row.port,
    database: row.database_name,
    username: row.username,
    credential_ref: credentialRef,
    ssl: row.ssl_mode,
    path: row.file_path,
    catalog: row.catalog_name,
    schema: row.schema_name,
    status: row.status,
    last_tested_at: row.last_tested_at ? timestamp(row.last_tested_at) : null,
    created_by_principal_id: row.created_by_principal_id,
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  });
}

function conversation(row: ConversationRow): WorkspaceConversation {
  return workspaceConversationSchema.parse({
    schema_version: "workspace-conversation@1.0.0",
    workspace_id: row.tenant_id,
    conversation_id: row.conversation_id,
    owner_principal_id: row.owner_principal_id,
    title: row.title,
    datasource_id: row.datasource_id,
    model_id: row.model_id,
    model_profile_id: row.model_profile_id,
    resource_version: Number(row.resource_version),
    message_count: Number(row.message_count),
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  });
}

function message(row: MessageRow): WorkspaceConversationMessage {
  return workspaceConversationMessageSchema.parse({
    schema_version: "workspace-conversation-message@1.0.0",
    workspace_id: row.tenant_id,
    conversation_id: row.conversation_id,
    message_id: row.message_id,
    role: row.role,
    content: row.content,
    type: row.message_type,
    run_id: row.run_id,
    metadata: row.metadata,
    created_at: timestamp(row.created_at),
  });
}

function runBinding(row: RunBindingRow): WorkspaceRunBinding {
  return workspaceRunBindingSchema.parse({
    schema_version: "workspace-run-binding@1.0.0",
    workspace_id: row.tenant_id,
    run_id: row.run_id,
    datasource_id: row.datasource_id,
    conversation_id: row.conversation_id,
    principal_id: row.principal_id,
    created_at: timestamp(row.created_at),
  });
}

function mapWorkspaceDataDatabaseError(error: unknown): PortResult<never> | null {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown; readonly message?: unknown })
      : null;
  const marker = typeof candidate?.message === "string" ? candidate.message : "";
  if (marker.includes("CONVERSATION_DATASOURCE_FROZEN")) {
    return invalid("CONVERSATION_DATASOURCE_FROZEN", "对话的数据源在写入消息后不可变更。");
  }
  if (marker.includes("CONVERSATION_RESOURCES_FROZEN")) {
    return invalid("CONVERSATION_RESOURCES_FROZEN", "已有消息的对话资源不可原地变更。");
  }
  if (marker.includes("CONVERSATION_RESOURCE_VERSION_CONFLICT")) {
    return invalid("CONVERSATION_RESOURCE_VERSION_CONFLICT", "对话资源版本已变化，请刷新后重试。");
  }
  if (marker.includes("MODEL_PROFILE_NOT_AVAILABLE")) {
    return invalid("MODEL_PROFILE_NOT_AVAILABLE", "所选模型当前不可运行。");
  }
  if (marker.includes("CONVERSATION_RESOURCES_REQUIRED")) {
    return invalid("CONVERSATION_RESOURCES_REQUIRED", "发送消息前必须选择模型和数据源。");
  }
  if (marker.includes("CONVERSATION_DATASOURCE_REQUIRED")) {
    return invalid("CONVERSATION_DATASOURCE_REQUIRED", "发送消息前必须选择当前工作空间的数据源。");
  }
  if (marker.includes("DATASOURCE_NOT_FOUND_OR_DENIED")) {
    return invalid("DATASOURCE_NOT_FOUND_OR_DENIED", "数据源不存在或不属于当前工作空间。");
  }
  if (marker.includes("CONVERSATION_NOT_FOUND_OR_DENIED")) {
    return invalid("CONVERSATION_NOT_FOUND_OR_DENIED", "对话不存在或无权访问。");
  }
  if (marker.includes("FOLDER_NOT_FOUND_OR_DENIED")) {
    return invalid("FOLDER_NOT_FOUND_OR_DENIED", "文件夹不存在或无权访问。");
  }
  if (marker.includes("CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN")) {
    return invalid(
      "CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN",
      "对话仍有运行中或等待交互的分析，请先终止后再删除。",
    );
  }
  if (marker.includes("DIRECTORY_RESOURCE_VERSION_CONFLICT")) {
    return invalid("DIRECTORY_RESOURCE_VERSION_CONFLICT", "目录资源已更新，请刷新后重试。");
  }
  if (marker.includes("DIRECTORY_STATE_TRANSITION_INVALID")) {
    return invalid("DIRECTORY_STATE_TRANSITION_INVALID", "目录资源当前状态不允许此操作。");
  }
  if (marker.includes("DIRECTORY_OPERATION_REPLAY_MISMATCH")) {
    return invalid("DIRECTORY_OPERATION_REPLAY_MISMATCH", "重复目录操作与原请求不一致。");
  }
  if (marker.includes("QA_RETENTION_CLAIM_STALE")) {
    return invalid("QA_RETENTION_CLAIM_STALE", "回收站清理租约已失效。");
  }
  if (candidate?.code === "23505") {
    return invalid("IDENTITY_OPERATION_CONFLICT", "同名或同标识的工作空间对象已经存在。");
  }
  if (candidate?.code === "23503") {
    return invalid("WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED", "关联对象不存在或不属于当前工作空间。");
  }
  return null;
}

export interface PostgresWorkspaceDataRepository {
  listDatasources(capabilityInput: unknown): Promise<PortResult<readonly WorkspaceDatasource[]>>;
  getDatasource(
    capabilityInput: unknown,
    datasourceId: unknown,
  ): Promise<PortResult<WorkspaceDatasource | null>>;
  createDatasource(
    capabilityInput: unknown,
    input: unknown,
  ): Promise<PortResult<WorkspaceDatasource>>;
  disableDatasource(capabilityInput: unknown, datasourceId: unknown): Promise<PortResult<boolean>>;
  listConversations(
    capabilityInput: unknown,
  ): Promise<PortResult<readonly WorkspaceConversation[]>>;
  listConversationDirectory(
    capabilityInput: unknown,
    input: unknown,
  ): Promise<PortResult<WorkspaceConversationDirectoryPage>>;
  applyConversationDirectoryCommand(
    capabilityInput: unknown,
    input: unknown,
  ): Promise<PortResult<WorkspaceConversationDirectoryCommandResult>>;
  claimConversationRetention(
    capabilityInput: unknown,
    input: unknown,
  ): Promise<PortResult<readonly ConversationTrashRetentionClaim[]>>;
  completeConversationRetention(
    capabilityInput: unknown,
    input: unknown,
  ): Promise<PortResult<ConversationTrashRetentionReceipt>>;
  getConversation(
    capabilityInput: unknown,
    conversationId: unknown,
  ): Promise<PortResult<WorkspaceConversation | null>>;
  createConversation(
    capabilityInput: unknown,
    input: unknown,
  ): Promise<PortResult<WorkspaceConversation>>;
  bindConversationDatasource(
    capabilityInput: unknown,
    conversationId: unknown,
    input: unknown,
  ): Promise<PortResult<WorkspaceConversation>>;
  updateConversationModel(
    capabilityInput: unknown,
    conversationId: unknown,
    input: unknown,
  ): Promise<PortResult<WorkspaceConversation>>;
  switchConversationResources(
    capabilityInput: unknown,
    conversationId: unknown,
    input: unknown,
  ): Promise<PortResult<QaConversationResourceSwitchResult>>;
  deleteConversation(
    capabilityInput: unknown,
    conversationId: unknown,
  ): Promise<PortResult<boolean>>;
  listMessages(
    capabilityInput: unknown,
    conversationId: unknown,
  ): Promise<PortResult<readonly WorkspaceConversationMessage[]>>;
  appendMessage(
    capabilityInput: unknown,
    conversationId: unknown,
    input: unknown,
  ): Promise<PortResult<WorkspaceConversationMessage>>;
  bindRun(capabilityInput: unknown, input: unknown): Promise<PortResult<WorkspaceRunBinding>>;
  getRunBinding(
    capabilityInput: unknown,
    runId: unknown,
  ): Promise<PortResult<WorkspaceRunBinding | null>>;
  listRunBindingsForConversation(
    capabilityInput: unknown,
    conversationId: unknown,
  ): Promise<PortResult<readonly WorkspaceRunBinding[]>>;
}

export function createPostgresWorkspaceDataRepository(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
): PostgresWorkspaceDataRepository {
  const transactionOptions = {
    map_database_error: mapWorkspaceDataDatabaseError,
  } as const;

  return {
    async listDatasources(capabilityInput) {
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "workspace.datasource.list", ...transactionOptions },
        async ({ client }) => {
          const result = await client.query<DatasourceRow>(
            `select ${datasourceColumns} from datasource_connections
             order by updated_at desc, datasource_id`,
          );
          return result.rows.map(datasource);
        },
      );
    },

    async getDatasource(capabilityInput, datasourceId) {
      const parsed = idInputSchema.safeParse({ id: datasourceId });
      if (!parsed.success) return invalid("DATASOURCE_INPUT_INVALID", "数据源标识无效。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "workspace.datasource.get", ...transactionOptions },
        async ({ client }) => {
          const result = await client.query<DatasourceRow>(
            `select ${datasourceColumns} from datasource_connections where datasource_id = $1::uuid`,
            [parsed.data.id],
          );
          return result.rows[0] ? datasource(result.rows[0]) : null;
        },
      );
    },

    async createDatasource(capabilityInput, input) {
      const parsed = createWorkspaceDatasourceInputSchema.safeParse(input);
      if (!parsed.success) return invalid("DATASOURCE_INPUT_INVALID", "数据源配置不符合契约。");
      const credential = parsed.data.credential_ref;
      if (credential && credential.rotation_state !== "ACTIVE") {
        return invalid("DATASOURCE_CREDENTIAL_SCOPE_INVALID", "数据源只能绑定 ACTIVE SecretRef。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "workspace.datasource.create",
          ...transactionOptions,
        },
        async ({ capability, client }) => {
          if (
            credential &&
            (credential.app_id !== capability.scope.app_id ||
              credential.tenant_id !== capability.scope.tenant_id ||
              credential.environment !== capability.scope.environment)
          ) {
            throw new PersistenceBoundaryError(
              "DATASOURCE_CREDENTIAL_SCOPE_INVALID",
              "SecretRef 不属于当前工作空间。",
            );
          }
          if (credential) {
            const secret = await client.query<{ readonly allowed: boolean }>(
              `select exists (
                 select 1 from secret_refs
                 where secret_ref_id = $1::uuid
                   and version = $2::bigint
                   and status = 'ACTIVE'
               ) as allowed`,
              [credential.secret_ref_id, credential.secret_version],
            );
            if (secret.rows[0]?.allowed !== true) {
              throw new PersistenceBoundaryError(
                "DATASOURCE_CREDENTIAL_SCOPE_INVALID",
                "SecretRef 不存在、已过期或不属于当前工作空间。",
              );
            }
          }
          const result = await client.query<DatasourceRow>(
            `insert into datasource_connections (
               app_id, tenant_id, environment, datasource_id, name, datasource_type,
               host, port, database_name, username, credential_ref_id, secret_ref_id,
               secret_version, rotation_state, ssl_mode, file_path, catalog_name, schema_name,
               created_by_principal_id
             ) values (
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text,
               $7::text, $8::integer, $9::text, $10::text, $11::uuid, $12::uuid,
               $13::bigint, $14::text, $15::text, $16::text, $17::text, $18::text, $19::uuid
             ) returning ${datasourceColumns}`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.datasource_id ?? randomUUID(),
              parsed.data.name,
              parsed.data.type,
              parsed.data.host,
              parsed.data.port,
              parsed.data.database,
              parsed.data.username,
              credential?.credential_ref_id ?? null,
              credential?.secret_ref_id ?? null,
              credential?.secret_version ?? null,
              credential?.rotation_state ?? null,
              parsed.data.ssl,
              parsed.data.path,
              parsed.data.catalog,
              parsed.data.schema,
              capability.principal,
            ],
          );
          return datasource(
            requireRow(result.rows[0], "DATASOURCE_INPUT_INVALID", "数据源创建结果无效。"),
          );
        },
      );
    },

    async disableDatasource(capabilityInput, datasourceId) {
      const parsed = idInputSchema.safeParse({ id: datasourceId });
      if (!parsed.success) return invalid("DATASOURCE_INPUT_INVALID", "数据源标识无效。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER"],
          operation_name: "workspace.datasource.disable",
          ...transactionOptions,
        },
        async ({ client }) => {
          const result = await client.query(
            `update datasource_connections
             set status = 'DISABLED', updated_at = pg_catalog.clock_timestamp()
             where datasource_id = $1::uuid and status <> 'DISABLED'`,
            [parsed.data.id],
          );
          if (result.rowCount === 0) {
            const current = await client.query(
              "select 1 from datasource_connections where datasource_id = $1::uuid",
              [parsed.data.id],
            );
            if (current.rowCount === 0) {
              throw new PersistenceBoundaryError(
                "DATASOURCE_NOT_FOUND_OR_DENIED",
                "数据源不存在或不属于当前工作空间。",
              );
            }
          }
          return true;
        },
      );
    },

    async listConversations(capabilityInput) {
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "workspace.conversation.list", ...transactionOptions },
        async ({ client }) => {
          const result = await client.query<ConversationRow>(
            `select ${conversationColumns} from qa_conversations as conversation
             where conversation.deleted_at is null and conversation.archived_at is null
               and (conversation.folder_id is null or exists (
                 select 1 from qa_conversation_folders as folder
                 where folder.folder_id = conversation.folder_id
                   and folder.owner_principal_id = conversation.owner_principal_id
                   and folder.archived_at is null
               ))
             order by conversation.updated_at desc, conversation.conversation_id`,
          );
          return result.rows.map(conversation);
        },
      );
    },

    async listConversationDirectory(capabilityInput, input) {
      const query = workspaceConversationDirectoryQuerySchema.safeParse(input);
      if (!query.success) return invalid("QA_DIRECTORY_QUERY_INVALID", "目录查询不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "workspace.conversation.directory",
          ...transactionOptions,
        },
        async ({ client }) => {
          const result = await client.query<{ readonly result: unknown }>(
            "select app_data_agent.list_qa_conversation_directory($1::jsonb) as result",
            [query.data],
          );
          return workspaceConversationDirectoryPageSchema.parse(result.rows[0]?.result);
        },
      );
    },

    async applyConversationDirectoryCommand(capabilityInput, input) {
      let command: Awaited<ReturnType<typeof verifyWorkspaceConversationDirectoryCommand>>;
      try {
        command = await verifyWorkspaceConversationDirectoryCommand(input);
      } catch {
        return invalid("QA_DIRECTORY_COMMAND_INVALID", "目录操作不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "workspace.conversation.directory.command",
          ...transactionOptions,
        },
        async ({ client }) => {
          const result = await client.query<{ readonly result: unknown }>(
            "select app_data_agent.apply_qa_directory_command($1::jsonb) as result",
            [command],
          );
          return workspaceConversationDirectoryCommandResultSchema.parse(result.rows[0]?.result);
        },
      );
    },

    async claimConversationRetention(capabilityInput, input) {
      const parsed = conversationTrashRetentionClaimInputSchema.safeParse(input);
      if (!parsed.success) return invalid("QA_RETENTION_CLAIM_INPUT_INVALID", "清理领取参数无效。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "workspace.conversation.retention.claim",
          ...transactionOptions,
        },
        async ({ client }) => {
          const result = await client.query<{ readonly result: unknown }>(
            "select app_data_agent.claim_qa_conversation_retention($1::integer,$2::integer) as result",
            [parsed.data.limit, parsed.data.lease_duration_ms],
          );
          return conversationTrashRetentionClaimSchema.array().parse(result.rows[0]?.result);
        },
      );
    },

    async completeConversationRetention(capabilityInput, input) {
      const parsed = conversationTrashRetentionCompleteInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalid("QA_RETENTION_COMPLETION_INVALID", "清理完成参数无效。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "WRITE",
          allowed_roles: ["OWNER", "ANALYST"],
          operation_name: "workspace.conversation.retention.complete",
          ...transactionOptions,
        },
        async ({ client }) => {
          const result = await client.query<{ readonly result: unknown }>(
            "select app_data_agent.complete_qa_conversation_retention($1::jsonb) as result",
            [parsed.data],
          );
          return conversationTrashRetentionReceiptSchema.parse(result.rows[0]?.result);
        },
      );
    },

    async getConversation(capabilityInput, conversationId) {
      const parsed = idInputSchema.safeParse({ id: conversationId });
      if (!parsed.success) return invalid("CONVERSATION_INPUT_INVALID", "对话标识无效。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "workspace.conversation.get", ...transactionOptions },
        async ({ client }) => {
          const result = await client.query<ConversationRow>(
            `select ${conversationColumns} from qa_conversations as conversation
             where conversation.conversation_id = $1::uuid
               and conversation.deleted_at is null`,
            [parsed.data.id],
          );
          return result.rows[0] ? conversation(result.rows[0]) : null;
        },
      );
    },

    async createConversation(capabilityInput, input) {
      const parsed = createWorkspaceConversationInputSchema.safeParse(input);
      if (!parsed.success) return invalid("CONVERSATION_INPUT_INVALID", "对话配置不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "workspace.conversation.create", ...transactionOptions },
        async ({ capability, client }) => {
          if (parsed.data.datasource_id) {
            const source = await client.query(
              `select 1 from datasource_connections
               where datasource_id = $1::uuid and status = 'ACTIVE'`,
              [parsed.data.datasource_id],
            );
            if (source.rowCount !== 1) {
              throw new PersistenceBoundaryError(
                "DATASOURCE_NOT_FOUND_OR_DENIED",
                "数据源不存在或不属于当前工作空间。",
              );
            }
          }
          const result = await client.query<ConversationRow>(
            `with inserted as (
               insert into qa_conversations (
                 app_id, tenant_id, environment, conversation_id, owner_principal_id,
                 title, datasource_id, model_id, model_profile_id
               ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::uuid, $8::text, $9::uuid)
               returning *
             )
             select inserted.*, 0::bigint as message_count from inserted`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.conversation_id ?? randomUUID(),
              capability.principal,
              parsed.data.title,
              parsed.data.datasource_id,
              parsed.data.model_profile_id?.toString() ?? parsed.data.model_id,
              parsed.data.model_profile_id ?? null,
            ],
          );
          return conversation(
            requireRow(result.rows[0], "CONVERSATION_INPUT_INVALID", "对话创建结果无效。"),
          );
        },
      );
    },

    async bindConversationDatasource(capabilityInput, conversationId, input) {
      const parsedId = idInputSchema.safeParse({ id: conversationId });
      const parsed = bindWorkspaceConversationDatasourceInputSchema.safeParse(input);
      if (!parsedId.success || !parsed.success) {
        return invalid("CONVERSATION_INPUT_INVALID", "对话或数据源标识无效。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "workspace.conversation.bind", ...transactionOptions },
        async ({ client }) => {
          const source = await client.query(
            `select 1 from datasource_connections
             where datasource_id = $1::uuid and status = 'ACTIVE'`,
            [parsed.data.datasource_id],
          );
          if (source.rowCount !== 1) {
            throw new PersistenceBoundaryError(
              "DATASOURCE_NOT_FOUND_OR_DENIED",
              "数据源不存在或不属于当前工作空间。",
            );
          }
          const result = await client.query<ConversationRow>(
            `with updated as (
               update qa_conversations
               set datasource_id = $2::uuid
               where conversation_id = $1::uuid
               returning *
             )
             select updated.*,
               (select pg_catalog.count(*) from qa_messages as message
                where message.app_id = updated.app_id
                  and message.tenant_id = updated.tenant_id
                  and message.environment = updated.environment
                  and message.conversation_id = updated.conversation_id) as message_count
             from updated`,
            [parsedId.data.id, parsed.data.datasource_id],
          );
          return conversation(
            requireRow(
              result.rows[0],
              "CONVERSATION_NOT_FOUND_OR_DENIED",
              "对话不存在或无权访问。",
            ),
          );
        },
      );
    },

    async updateConversationModel(capabilityInput, conversationId, input) {
      const parsedId = idInputSchema.safeParse({ id: conversationId });
      const parsed = updateWorkspaceConversationModelInputSchema.safeParse(input);
      if (!parsedId.success || !parsed.success) {
        return invalid("CONVERSATION_INPUT_INVALID", "对话或模型标识无效。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "workspace.conversation.model", ...transactionOptions },
        async ({ client }) => {
          const result = await client.query<ConversationRow>(
            `with updated as (
               update qa_conversations set model_id = $2::text
               where conversation_id = $1::uuid returning *
             )
             select updated.*,
               (select pg_catalog.count(*) from qa_messages as message
                where message.app_id = updated.app_id
                  and message.tenant_id = updated.tenant_id
                  and message.environment = updated.environment
                  and message.conversation_id = updated.conversation_id) as message_count
             from updated`,
            [parsedId.data.id, parsed.data.model_id],
          );
          return conversation(
            requireRow(
              result.rows[0],
              "CONVERSATION_NOT_FOUND_OR_DENIED",
              "对话不存在或无权访问。",
            ),
          );
        },
      );
    },

    async switchConversationResources(capabilityInput, conversationId, input) {
      const parsedId = idInputSchema.safeParse({ id: conversationId });
      const parsed = qaConversationResourceSwitchInputSchema.safeParse(input);
      if (!parsedId.success || !parsed.success) {
        return invalid("CONVERSATION_INPUT_INVALID", "对话资源切换请求不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace.conversation.resources.switch",
          ...transactionOptions,
        },
        async ({ client }) => {
          const result = await client.query<{ readonly result: unknown }>(
            "select app_data_agent.switch_qa_conversation_resources($1::jsonb) as result",
            [
              {
                ...parsed.data,
                operation_id: randomUUID(),
                conversation_id: parsedId.data.id,
              },
            ],
          );
          return qaConversationResourceSwitchResultSchema.parse(result.rows[0]?.result);
        },
      );
    },

    async deleteConversation(capabilityInput, conversationId) {
      const parsed = idInputSchema.safeParse({ id: conversationId });
      if (!parsed.success) return invalid("CONVERSATION_INPUT_INVALID", "对话标识无效。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "workspace.conversation.delete", ...transactionOptions },
        async ({ client }) => {
          const current = await client.query<{ readonly resource_version: string | number }>(
            "select resource_version from qa_conversations where conversation_id = $1::uuid and deleted_at is null for update",
            [parsed.data.id],
          );
          if (current.rowCount !== 1 || !current.rows[0]) {
            throw new PersistenceBoundaryError(
              "CONVERSATION_NOT_FOUND_OR_DENIED",
              "对话不存在或无权访问。",
            );
          }
          const command = await buildWorkspaceConversationDirectoryCommand({
            schema_version: "workspace-conversation-directory-command@1.0.0",
            operation_id: randomUUID(),
            idempotency_key: `legacy-trash:${randomUUID()}`,
            action: "CONVERSATION_TRASH",
            conversation_id: parsed.data.id,
            expected_resource_version: Number(current.rows[0].resource_version),
            confirmed: true,
          });
          await client.query("select app_data_agent.apply_qa_directory_command($1::jsonb)", [
            command,
          ]);
          return true;
        },
      );
    },

    async listMessages(capabilityInput, conversationId) {
      const parsed = idInputSchema.safeParse({ id: conversationId });
      if (!parsed.success) return invalid("CONVERSATION_INPUT_INVALID", "对话标识无效。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "workspace.message.list", ...transactionOptions },
        async ({ client }) => {
          const current = await client.query(
            "select 1 from qa_conversations where conversation_id = $1::uuid and deleted_at is null",
            [parsed.data.id],
          );
          if (current.rowCount !== 1) {
            throw new PersistenceBoundaryError(
              "CONVERSATION_NOT_FOUND_OR_DENIED",
              "对话不存在或无权访问。",
            );
          }
          const result = await client.query<MessageRow>(
            `select app_id, tenant_id, environment, conversation_id, message_id,
                    role, content, message_type, run_id, metadata, created_at
             from qa_messages where conversation_id = $1::uuid
             order by created_at, message_id`,
            [parsed.data.id],
          );
          return result.rows.map(message);
        },
      );
    },

    async appendMessage(capabilityInput, conversationId, input) {
      const parsedId = idInputSchema.safeParse({ id: conversationId });
      const parsed = appendWorkspaceConversationMessageInputSchema.safeParse(input);
      if (!parsedId.success || !parsed.success) {
        return invalid("CONVERSATION_INPUT_INVALID", "消息内容不符合契约。");
      }
      if (
        containsPotentialPlaintextSecret(parsed.data.content) ||
        containsPotentialPlaintextSecret(parsed.data.metadata)
      ) {
        return invalid("CONVERSATION_INPUT_INVALID", "消息不得包含明文凭据。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "workspace.message.append", ...transactionOptions },
        async ({ capability, client }) => {
          const current = await client.query(
            "select 1 from qa_conversations where conversation_id = $1::uuid and deleted_at is null for share",
            [parsedId.data.id],
          );
          if (current.rowCount !== 1) {
            throw new PersistenceBoundaryError(
              "CONVERSATION_NOT_FOUND_OR_DENIED",
              "对话不存在或无权访问。",
            );
          }
          const result = await client.query<MessageRow>(
            `insert into qa_messages (
               app_id, tenant_id, environment, conversation_id, message_id,
               owner_principal_id, role, content, message_type, run_id, metadata
             ) values (
               $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid,
               $6::uuid, $7::text, $8::text, $9::text, $10::uuid, $11::jsonb
             )
             returning app_id, tenant_id, environment, conversation_id, message_id,
                       role, content, message_type, run_id, metadata, created_at`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsedId.data.id,
              parsed.data.message_id ?? randomUUID(),
              capability.principal,
              parsed.data.role,
              parsed.data.content,
              parsed.data.type,
              parsed.data.run_id,
              JSON.stringify(parsed.data.metadata),
            ],
          );
          return message(
            requireRow(
              result.rows[0],
              "CONVERSATION_NOT_FOUND_OR_DENIED",
              "消息写入失败或对话无权访问。",
            ),
          );
        },
      );
    },

    async bindRun(capabilityInput, input) {
      const parsed = bindWorkspaceRunInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalid("RUN_DATASOURCE_BINDING_INVALID", "Run 数据源归因不符合契约。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE", operation_name: "workspace.run.bind", ...transactionOptions },
        async ({ capability, client }) => {
          const result = await client.query<RunBindingRow>(
            `insert into workspace_run_bindings (
               app_id, tenant_id, environment, run_id, datasource_id, conversation_id, principal_id
             ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::uuid, $7::uuid)
             returning app_id, tenant_id, environment, run_id, datasource_id,
                       conversation_id, principal_id, created_at`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              parsed.data.run_id,
              parsed.data.datasource_id,
              parsed.data.conversation_id,
              capability.principal,
            ],
          );
          return runBinding(
            requireRow(
              result.rows[0],
              "RUN_DATASOURCE_BINDING_INVALID",
              "Run 数据源归因写入失败。",
            ),
          );
        },
      );
    },

    async getRunBinding(capabilityInput, runId) {
      const parsed = idInputSchema.safeParse({ id: runId });
      if (!parsed.success) {
        return invalid("RUN_DATASOURCE_BINDING_INVALID", "Run 标识无效。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "READ", operation_name: "workspace.run.binding", ...transactionOptions },
        async ({ client }) => {
          const result = await client.query<RunBindingRow>(
            `select binding.app_id, binding.tenant_id, binding.environment, binding.run_id,
                    binding.datasource_id, binding.conversation_id, binding.principal_id,
                    binding.created_at
             from workspace_run_bindings as binding
             join qa_conversations as conversation
               on conversation.app_id = binding.app_id
              and conversation.tenant_id = binding.tenant_id
              and conversation.environment = binding.environment
              and conversation.owner_principal_id = binding.principal_id
              and conversation.conversation_id = binding.conversation_id
              and conversation.deleted_at is null
             where binding.run_id = $1::uuid`,
            [parsed.data.id],
          );
          return result.rows[0] ? runBinding(result.rows[0]) : null;
        },
      );
    },

    async listRunBindingsForConversation(capabilityInput, conversationId) {
      const parsed = idInputSchema.safeParse({ id: conversationId });
      if (!parsed.success) {
        return invalid("CONVERSATION_INPUT_INVALID", "对话标识无效。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "workspace.run.bindings_by_conversation",
          ...transactionOptions,
        },
        async ({ client }) => {
          const current = await client.query(
            "select 1 from qa_conversations where conversation_id = $1::uuid and deleted_at is null",
            [parsed.data.id],
          );
          if (current.rowCount !== 1) {
            throw new PersistenceBoundaryError(
              "CONVERSATION_NOT_FOUND_OR_DENIED",
              "对话不存在或无权访问。",
            );
          }
          const result = await client.query<RunBindingRow>(
            `select app_id, tenant_id, environment, run_id, datasource_id,
                    conversation_id, principal_id, created_at
             from workspace_run_bindings
             where conversation_id = $1::uuid
             order by created_at, run_id`,
            [parsed.data.id],
          );
          return result.rows.map(runBinding);
        },
      );
    },
  };
}
