import { describe, expect, it } from "vitest";
import {
  appendWorkspaceConversationMessageInputSchema,
  bindWorkspaceConversationDatasourceInputSchema,
  bindWorkspaceRunInputSchema,
  createWorkspaceConversationInputSchema,
  createWorkspaceDatasourceInputSchema,
  qaConversationResourceSwitchInputSchema,
  qaConversationResourceSwitchResultSchema,
  qaResourceCatalogSchema,
  qaRunBindingSchema,
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
      resource_version: 7,
      status: "ACTIVE",
      last_tested_at: null,
      created_by_principal_id: ids.principal,
      created_at: at,
      updated_at: at,
    } as const;
    expect(workspaceDatasourceSchema.parse(projection)).toEqual(projection);
    rejectsUnknown(workspaceDatasourceSchema, projection);
    const { resource_version: _resourceVersion, ...projectionWithoutVersion } = projection;
    expect(workspaceDatasourceSchema.safeParse(projectionWithoutVersion).success).toBe(false);
    expect(
      workspaceDatasourceSchema.safeParse({ ...projection, resource_version: 0 }).success,
    ).toBe(false);
    expect(
      workspaceDatasourceSchema.safeParse({
        ...projection,
        resource_version: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
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

describe("Q&A immutable resource contracts", () => {
  const modelProfile = "30000000-0000-4000-8000-000000000003";

  it("keeps the public resource catalog strict and credential-free", () => {
    const catalog = {
      schema_version: "qa-resource-catalog@1.0.0",
      models: [
        {
          model_profile_id: modelProfile,
          config_version: 2,
          profile_version: "model-profile@2",
          provider: "deepseek",
          model_id: "deepseek-v4-pro",
          display_name: "DeepSeek",
          certification_receipt_ref: {
            artifact_id: ids.message,
            artifact_type: "ModelCertificationReceipt",
            app_id: ids.app,
            tenant_id: ids.workspace,
            environment: "test",
            run_id: ids.run,
            revision: 1,
            content_hash: `sha256:${"a".repeat(64)}`,
          },
          effective_context_ceiling_tokens: 16_000,
          effective_output_ceiling_tokens: 4_000,
          readiness: "AVAILABLE",
          selectable: true,
        },
      ],
      datasources: [
        {
          datasource_id: ids.datasource,
          display_name: "Warehouse",
          type: "postgresql",
          status: "ACTIVE",
          selectable: true,
        },
      ],
    } as const;
    expect(qaResourceCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(
      qaResourceCatalogSchema.safeParse({
        ...catalog,
        models: [{ ...catalog.models[0], profile_version: "model-profile@3" }],
      }).success,
    ).toBe(false);

    const directCatalog = {
      ...catalog,
      models: [
        {
          ...catalog.models[0],
          certification_receipt_ref: null,
          effective_context_ceiling_tokens: null,
          effective_output_ceiling_tokens: null,
          api_authentication_state: "NOT_CERTIFIED",
        },
      ],
    } as const;
    expect(qaResourceCatalogSchema.parse(directCatalog)).toEqual(directCatalog);
    expect(
      qaResourceCatalogSchema.safeParse({
        ...catalog,
        models: [
          {
            ...catalog.models[0],
            readiness: "CERTIFICATION_REQUIRED",
            selectable: false,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      qaResourceCatalogSchema.safeParse({
        ...catalog,
        models: [{ ...catalog.models[0], api_key: "forbidden" }],
      }).success,
    ).toBe(false);
  });

  it("distinguishes in-place updates from replacement conversations", () => {
    expect(
      qaConversationResourceSwitchInputSchema.parse({
        schema_version: "qa-conversation-resource-switch@1.0.0",
        model_profile_id: modelProfile,
        datasource_id: ids.datasource,
        expected_resource_version: 3,
        idempotency_key: "switch-resource-001",
      }).expected_resource_version,
    ).toBe(3);

    const projection = {
      schema_version: "workspace-conversation@1.0.0",
      workspace_id: ids.workspace,
      conversation_id: ids.conversation,
      owner_principal_id: ids.principal,
      title: "Revenue analysis",
      datasource_id: ids.datasource,
      model_id: modelProfile,
      model_profile_id: modelProfile,
      resource_version: 1,
      message_count: 0,
      created_at: at,
      updated_at: at,
    } as const;
    expect(
      qaConversationResourceSwitchResultSchema.parse({
        kind: "CREATED_REPLACEMENT",
        conversation: projection,
        replaced_id: "00000000-0000-4000-8000-00000000c002",
      }).kind,
    ).toBe("CREATED_REPLACEMENT");
  });

  it("requires a complete, credential-free Run resource snapshot", () => {
    const binding = {
      schema_version: "qa-run-binding@1.0.0",
      workspace_id: ids.workspace,
      run_id: ids.run,
      conversation_id: ids.conversation,
      principal_id: ids.principal,
      datasource_id: ids.datasource,
      datasource_binding_hash: `sha256:${"0".repeat(64)}`,
      model_profile_id: modelProfile,
      model_config_version: 2,
      provider: "deepseek",
      model_id: "deepseek-v4-pro",
      created_at: at,
    } as const;
    expect(qaRunBindingSchema.parse(binding)).toEqual(binding);
    expect(
      qaRunBindingSchema.safeParse({ ...binding, secret_ref: "secretref:value" }).success,
    ).toBe(false);
  });
});
