import { describe, expect, it } from "vitest";
import {
  appendWorkspaceConversationMessageInputSchema,
  bindWorkspaceConversationDatasourceInputSchema,
  bindWorkspaceRunInputSchema,
  createWorkspaceConversationInputSchema,
  createWorkspaceDatasourceInputSchema,
  workspaceConversationMessageSchema,
  workspaceConversationSchema,
  workspaceDatasourceSchema,
  workspaceRunBindingSchema,
} from "../src/index.js";

const ids = {
  workspace: "00000000-0000-4000-8000-00000000aa11",
  datasource: "00000000-0000-4000-8000-00000000d001",
  conversation: "00000000-0000-4000-8000-00000000c001",
  message: "00000000-0000-4000-8000-00000000e001",
  principal: "00000000-0000-4000-8000-000000001001",
  run: "00000000-0000-4000-8000-00000000f001",
  secret: "00000000-0000-4000-8000-00000000a001",
  credential: "00000000-0000-4000-8000-00000000a002",
  app: "00000000-0000-4000-8000-00000000da01",
} as const;
const at = "2026-08-14T10:00:00.000Z";

function rejectsUnknown(
  schema: { safeParse(value: unknown): { success: boolean } },
  value: object,
) {
  expect(schema.safeParse({ ...value, caller_role: "SUPER_ADMIN" }).success).toBe(false);
}

describe("workspace datasource contracts", () => {
  const input = {
    schema_version: "workspace-datasource-create@1.0.0",
    datasource_id: ids.datasource,
    name: "Warehouse",
    type: "postgresql",
    host: "db.internal",
    port: 5432,
    database: "analytics",
    username: "reader",
    credential_ref: {
      schema_version: "datasource-credential-ref@1.0.0",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      credential_ref_id: ids.credential,
      secret_ref_id: ids.secret,
      secret_version: 1,
      rotation_state: "ACTIVE",
    },
    ssl: "verify-full",
    path: null,
    catalog: null,
    schema: null,
  } as const;

  it("strictly accepts provider-neutral connection metadata", () => {
    expect(createWorkspaceDatasourceInputSchema.parse(input)).toEqual(input);
    rejectsUnknown(createWorkspaceDatasourceInputSchema, input);
    expect(
      createWorkspaceDatasourceInputSchema.safeParse({ ...input, password: "not-allowed" }).success,
    ).toBe(false);
  });

  it("returns a scoped, versioned datasource projection", () => {
    const projection = {
      ...input,
      schema_version: "workspace-datasource@1.0.0",
      workspace_id: ids.workspace,
      status: "ACTIVE",
      last_tested_at: null,
      created_by_principal_id: ids.principal,
      created_at: at,
      updated_at: at,
    } as const;
    expect(workspaceDatasourceSchema.parse(projection)).toEqual(projection);
    rejectsUnknown(workspaceDatasourceSchema, projection);
  });
});

describe("workspace conversation and run binding contracts", () => {
  it("allows datasource selection before messages and rejects loose payloads", () => {
    const create = {
      schema_version: "workspace-conversation-create@1.0.0",
      conversation_id: ids.conversation,
      title: "Revenue analysis",
      datasource_id: null,
      model_id: null,
    } as const;
    expect(createWorkspaceConversationInputSchema.parse(create)).toEqual(create);
    rejectsUnknown(createWorkspaceConversationInputSchema, create);
    expect(
      bindWorkspaceConversationDatasourceInputSchema.parse({
        schema_version: "workspace-conversation-bind-datasource@1.0.0",
        datasource_id: ids.datasource,
      }).datasource_id,
    ).toBe(ids.datasource);
  });

  it("strictly snapshots messages, conversations and run attribution", () => {
    const conversation = {
      schema_version: "workspace-conversation@1.0.0",
      workspace_id: ids.workspace,
      conversation_id: ids.conversation,
      owner_principal_id: ids.principal,
      title: "Revenue analysis",
      datasource_id: ids.datasource,
      model_id: null,
      message_count: 1,
      created_at: at,
      updated_at: at,
    } as const;
    expect(workspaceConversationSchema.parse(conversation)).toEqual(conversation);

    const append = {
      schema_version: "workspace-conversation-message-append@1.0.0",
      message_id: ids.message,
      role: "user",
      content: "Why did revenue fall?",
      type: "text",
      run_id: null,
      metadata: {},
    } as const;
    expect(appendWorkspaceConversationMessageInputSchema.parse(append)).toEqual(append);
    rejectsUnknown(appendWorkspaceConversationMessageInputSchema, append);

    const message = {
      schema_version: "workspace-conversation-message@1.0.0",
      workspace_id: ids.workspace,
      conversation_id: ids.conversation,
      message_id: ids.message,
      role: "user",
      content: append.content,
      type: "text",
      run_id: null,
      metadata: {},
      created_at: at,
    } as const;
    expect(workspaceConversationMessageSchema.parse(message)).toEqual(message);

    const binding = {
      schema_version: "workspace-run-binding@1.0.0",
      workspace_id: ids.workspace,
      run_id: ids.run,
      datasource_id: ids.datasource,
      conversation_id: ids.conversation,
      principal_id: ids.principal,
      created_at: at,
    } as const;
    expect(workspaceRunBindingSchema.parse(binding)).toEqual(binding);
    expect(
      bindWorkspaceRunInputSchema.parse({
        schema_version: "workspace-run-bind@1.0.0",
        run_id: ids.run,
        datasource_id: ids.datasource,
        conversation_id: ids.conversation,
      }).run_id,
    ).toBe(ids.run);
  });
});
