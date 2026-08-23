import { describe, expect, it } from "vitest";
import {
  buildWorkspaceConversationDirectoryCommand,
  verifyWorkspaceConversationDirectoryCommand,
  workspaceConversationDirectoryCommandDraftSchema,
  workspaceConversationDirectoryPageSchema,
  workspaceConversationFolderSchema,
  workspaceConversationV2Schema,
} from "../src/index.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  folder: "10000000-0000-4000-8000-000000000003",
  conversation: "10000000-0000-4000-8000-000000000004",
  operation: "10000000-0000-4000-8000-000000000005",
};

const now = "2026-08-22T00:00:00.000Z";

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "workspace-conversation@2.0.0",
    workspace_id: ids.workspace,
    conversation_id: ids.conversation,
    owner_principal_id: ids.owner,
    title: "订单分析",
    datasource_id: null,
    model_id: null,
    model_profile_id: null,
    resource_version: 1,
    message_count: 0,
    folder_id: ids.folder,
    sort_order: 0,
    lifecycle: "ACTIVE",
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    live_state: "IDLE",
    unread_completed: false,
    search_snippet: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("workspace conversation directory contracts", () => {
  it("parses one owner directory page and rejects mixed owners", () => {
    const folder = workspaceConversationFolderSchema.parse({
      schema_version: "workspace-conversation-folder@1.0.0",
      workspace_id: ids.workspace,
      folder_id: ids.folder,
      owner_principal_id: ids.owner,
      name: "深度调研",
      sort_order: 0,
      resource_version: 1,
      archived_at: null,
      created_at: now,
      updated_at: now,
    });
    expect(
      workspaceConversationDirectoryPageSchema.parse({
        schema_version: "workspace-conversation-directory-page@1.0.0",
        workspace_id: ids.workspace,
        view: "active",
        folders: [folder],
        conversations: [conversation()],
        next_cursor: null,
      }).conversations,
    ).toHaveLength(1);
    expect(() =>
      workspaceConversationDirectoryPageSchema.parse({
        schema_version: "workspace-conversation-directory-page@1.0.0",
        workspace_id: ids.workspace,
        view: "active",
        folders: [folder],
        conversations: [
          conversation({ owner_principal_id: "10000000-0000-4000-8000-000000000099" }),
        ],
        next_cursor: null,
      }),
    ).toThrow();
  });

  it("enforces lifecycle timestamps and exact 30 day retention", () => {
    expect(workspaceConversationV2Schema.parse(conversation()).lifecycle).toBe("ACTIVE");
    expect(
      workspaceConversationV2Schema.parse(
        conversation({
          lifecycle: "TRASH",
          archived_at: null,
          deleted_at: "2026-08-22T00:00:00.000Z",
          purge_after: "2026-09-21T00:00:00.000Z",
        }),
      ).lifecycle,
    ).toBe("TRASH");
    expect(() =>
      workspaceConversationV2Schema.parse(
        conversation({
          lifecycle: "TRASH",
          deleted_at: now,
          purge_after: "2026-09-20T00:00:00.000Z",
        }),
      ),
    ).toThrow();
  });

  it("builds and verifies a hashed command and rejects tampering", async () => {
    const command = await buildWorkspaceConversationDirectoryCommand({
      schema_version: "workspace-conversation-directory-command@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "rename:1",
      action: "CONVERSATION_RENAME",
      conversation_id: ids.conversation,
      expected_resource_version: 1,
      title: "新标题",
    });
    await expect(verifyWorkspaceConversationDirectoryCommand(command)).resolves.toEqual(command);
    await expect(
      verifyWorkspaceConversationDirectoryCommand({ ...command, title: "篡改标题" }),
    ).rejects.toThrow("DIRECTORY_COMMAND_HASH_MISMATCH");
  });

  it("rejects unknown command fields and unconfirmed destructive actions", () => {
    expect(() =>
      workspaceConversationDirectoryCommandDraftSchema.parse({
        schema_version: "workspace-conversation-directory-command@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "trash:1",
        action: "CONVERSATION_TRASH",
        conversation_id: ids.conversation,
        expected_resource_version: 1,
        confirmed: false,
      }),
    ).toThrow();
    expect(() =>
      workspaceConversationDirectoryCommandDraftSchema.parse({
        schema_version: "workspace-conversation-directory-command@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "archive:1",
        action: "CONVERSATION_ARCHIVE",
        conversation_id: ids.conversation,
        expected_resource_version: 1,
        owner_principal_id: ids.owner,
      }),
    ).toThrow();
  });
});
