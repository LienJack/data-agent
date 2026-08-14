import { z } from "zod";
import { dataSourceCredentialRefSchema } from "../artifacts/semantic-governance-requests.js";
import { immutableIdSchema, timestampSchema, versionIdentifierSchema } from "../common/index.js";

export const workspaceDatasourceTypeSchema = z.enum([
  "postgresql",
  "mysql",
  "clickhouse",
  "sqlite",
  "trino",
]);

export const workspaceDatasourceSslSchema = z.enum([
  "disable",
  "require",
  "verify-ca",
  "verify-full",
]);

export const workspaceDatasourceStatusSchema = z.enum(["ACTIVE", "ERROR", "DISABLED"]);

const workspaceDatasourceFields = {
  name: z.string().trim().min(1).max(255),
  type: workspaceDatasourceTypeSchema,
  host: z.string().trim().min(1).max(255).nullable(),
  port: z.number().int().min(1).max(65_535).nullable(),
  database: z.string().trim().min(1).max(255).nullable(),
  username: z.string().trim().min(1).max(255).nullable(),
  credential_ref: dataSourceCredentialRefSchema.nullable(),
  ssl: workspaceDatasourceSslSchema,
  path: z.string().trim().min(1).max(4_096).nullable(),
  catalog: z.string().trim().min(1).max(255).nullable(),
  schema: z.string().trim().min(1).max(255).nullable(),
} as const;

export const workspaceDatasourceSchema = z.strictObject({
  schema_version: z.literal("workspace-datasource@1.0.0"),
  workspace_id: immutableIdSchema,
  datasource_id: immutableIdSchema,
  ...workspaceDatasourceFields,
  status: workspaceDatasourceStatusSchema,
  last_tested_at: timestampSchema.nullable(),
  created_by_principal_id: immutableIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const createWorkspaceDatasourceInputSchema = z.strictObject({
  schema_version: z.literal("workspace-datasource-create@1.0.0"),
  datasource_id: immutableIdSchema.optional(),
  ...workspaceDatasourceFields,
});

export const workspaceConversationSchema = z.strictObject({
  schema_version: z.literal("workspace-conversation@1.0.0"),
  workspace_id: immutableIdSchema,
  conversation_id: immutableIdSchema,
  owner_principal_id: immutableIdSchema,
  title: z.string().trim().min(1).max(255),
  datasource_id: immutableIdSchema.nullable(),
  model_id: versionIdentifierSchema.nullable(),
  message_count: z.number().int().nonnegative().safe(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const createWorkspaceConversationInputSchema = z.strictObject({
  schema_version: z.literal("workspace-conversation-create@1.0.0"),
  conversation_id: immutableIdSchema.optional(),
  title: workspaceConversationSchema.shape.title,
  datasource_id: immutableIdSchema.nullable().default(null),
  model_id: versionIdentifierSchema.nullable().default(null),
});

export const bindWorkspaceConversationDatasourceInputSchema = z.strictObject({
  schema_version: z.literal("workspace-conversation-bind-datasource@1.0.0"),
  datasource_id: immutableIdSchema,
});

export const updateWorkspaceConversationModelInputSchema = z.strictObject({
  schema_version: z.literal("workspace-conversation-update-model@1.0.0"),
  model_id: versionIdentifierSchema.nullable(),
});

export const workspaceMessageRoleSchema = z.enum(["user", "agent"]);
export const workspaceMessageTypeSchema = z.enum([
  "text",
  "table",
  "report",
  "hypothesis",
  "error",
]);

export const workspaceConversationMessageSchema = z.strictObject({
  schema_version: z.literal("workspace-conversation-message@1.0.0"),
  workspace_id: immutableIdSchema,
  conversation_id: immutableIdSchema,
  message_id: immutableIdSchema,
  role: workspaceMessageRoleSchema,
  content: z.string().trim().min(1).max(200_000),
  type: workspaceMessageTypeSchema,
  run_id: immutableIdSchema.nullable(),
  metadata: z.record(z.string().max(128), z.json()),
  created_at: timestampSchema,
});

export const appendWorkspaceConversationMessageInputSchema = z.strictObject({
  schema_version: z.literal("workspace-conversation-message-append@1.0.0"),
  message_id: immutableIdSchema.optional(),
  role: workspaceMessageRoleSchema,
  content: workspaceConversationMessageSchema.shape.content,
  type: workspaceMessageTypeSchema,
  run_id: immutableIdSchema.nullable().default(null),
  metadata: z.record(z.string().max(128), z.json()).default({}),
});

export const workspaceRunBindingSchema = z.strictObject({
  schema_version: z.literal("workspace-run-binding@1.0.0"),
  workspace_id: immutableIdSchema,
  run_id: immutableIdSchema,
  datasource_id: immutableIdSchema,
  conversation_id: immutableIdSchema.nullable(),
  principal_id: immutableIdSchema,
  created_at: timestampSchema,
});

export const bindWorkspaceRunInputSchema = z.strictObject({
  schema_version: z.literal("workspace-run-bind@1.0.0"),
  run_id: immutableIdSchema,
  datasource_id: immutableIdSchema,
  conversation_id: immutableIdSchema.nullable().default(null),
});

export type WorkspaceDatasourceType = z.infer<typeof workspaceDatasourceTypeSchema>;
export type WorkspaceDatasourceSsl = z.infer<typeof workspaceDatasourceSslSchema>;
export type WorkspaceDatasourceStatus = z.infer<typeof workspaceDatasourceStatusSchema>;
export type WorkspaceDatasource = z.infer<typeof workspaceDatasourceSchema>;
export type CreateWorkspaceDatasourceInput = z.infer<typeof createWorkspaceDatasourceInputSchema>;
export type WorkspaceConversation = z.infer<typeof workspaceConversationSchema>;
export type CreateWorkspaceConversationInput = z.infer<
  typeof createWorkspaceConversationInputSchema
>;
export type BindWorkspaceConversationDatasourceInput = z.infer<
  typeof bindWorkspaceConversationDatasourceInputSchema
>;
export type UpdateWorkspaceConversationModelInput = z.infer<
  typeof updateWorkspaceConversationModelInputSchema
>;
export type WorkspaceConversationMessage = z.infer<typeof workspaceConversationMessageSchema>;
export type AppendWorkspaceConversationMessageInput = z.infer<
  typeof appendWorkspaceConversationMessageInputSchema
>;
export type WorkspaceRunBinding = z.infer<typeof workspaceRunBindingSchema>;
export type BindWorkspaceRunInput = z.infer<typeof bindWorkspaceRunInputSchema>;
