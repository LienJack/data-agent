import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export const workspaceConversationDirectoryViewSchema = z.enum(["active", "archived", "trash"]);
export const workspaceConversationDirectoryQuerySchema = z.strictObject({
  schema_version: z.literal("workspace-conversation-directory-query@1.0.0"),
  view: workspaceConversationDirectoryViewSchema,
  folder_id: immutableIdSchema.nullable(),
  query: z.string().trim().min(1).max(120).nullable(),
  cursor: z.string().min(1).max(2_048).nullable(),
  limit: z.number().int().min(1).max(50),
});
export const workspaceConversationLifecycleSchema = z.enum(["ACTIVE", "ARCHIVED", "TRASH"]);
export const workspaceConversationLiveStateSchema = z.enum([
  "IDLE",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_ANSWER",
  "FAILED",
  "COMPLETED",
]);

export const workspaceConversationFolderSchema = z
  .strictObject({
    schema_version: z.literal("workspace-conversation-folder@1.0.0"),
    workspace_id: immutableIdSchema,
    folder_id: immutableIdSchema,
    owner_principal_id: immutableIdSchema,
    name: z.string().trim().min(1).max(80),
    sort_order: z.number().int().nonnegative().safe(),
    resource_version: z.number().int().positive().safe(),
    archived_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .superRefine((folder, ctx) => {
    if (new Date(folder.updated_at).getTime() < new Date(folder.created_at).getTime()) {
      ctx.addIssue({ code: "custom", message: "Folder updated_at 不能早于 created_at。" });
    }
  });

export const workspaceConversationV2Schema = z
  .strictObject({
    schema_version: z.literal("workspace-conversation@2.0.0"),
    workspace_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    owner_principal_id: immutableIdSchema,
    title: z.string().trim().min(1).max(255),
    datasource_id: immutableIdSchema.nullable(),
    model_id: versionIdentifierSchema.nullable(),
    model_profile_id: immutableIdSchema.nullable(),
    resource_version: z.number().int().positive().safe(),
    message_count: z.number().int().nonnegative().safe(),
    folder_id: immutableIdSchema.nullable(),
    sort_order: z.number().int().nonnegative().safe(),
    lifecycle: workspaceConversationLifecycleSchema,
    archived_at: timestampSchema.nullable(),
    deleted_at: timestampSchema.nullable(),
    purge_after: timestampSchema.nullable(),
    live_state: workspaceConversationLiveStateSchema,
    unread_completed: z.boolean(),
    search_snippet: z.string().max(180).nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .superRefine((conversation, ctx) => {
    const active =
      conversation.lifecycle === "ACTIVE" &&
      conversation.archived_at === null &&
      conversation.deleted_at === null &&
      conversation.purge_after === null;
    const archived =
      conversation.lifecycle === "ARCHIVED" &&
      conversation.archived_at !== null &&
      conversation.deleted_at === null &&
      conversation.purge_after === null;
    const trash =
      conversation.lifecycle === "TRASH" &&
      conversation.deleted_at !== null &&
      conversation.purge_after !== null;
    if (!(active || archived || trash)) {
      ctx.addIssue({ code: "custom", message: "Conversation lifecycle 时间字段不一致。" });
      return;
    }
    if (trash) {
      const duration =
        new Date(conversation.purge_after as string).getTime() -
        new Date(conversation.deleted_at as string).getTime();
      if (duration !== THIRTY_DAYS_MS) {
        ctx.addIssue({ code: "custom", message: "purge_after 必须等于 deleted_at 加 30 天。" });
      }
    }
  });

export const workspaceConversationDirectoryPageSchema = z
  .strictObject({
    schema_version: z.literal("workspace-conversation-directory-page@1.0.0"),
    workspace_id: immutableIdSchema,
    view: workspaceConversationDirectoryViewSchema,
    folders: z.array(workspaceConversationFolderSchema).max(500),
    conversations: z.array(workspaceConversationV2Schema).max(500),
    next_cursor: z.string().min(1).max(2_048).nullable(),
  })
  .superRefine((page, ctx) => {
    const expectedLifecycle = page.view.toUpperCase();
    for (const [index, conversation] of page.conversations.entries()) {
      if (
        conversation.workspace_id !== page.workspace_id ||
        conversation.lifecycle !== expectedLifecycle
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Directory page scope 或 lifecycle 不一致。",
          path: ["conversations", index],
        });
      }
    }
    const owners = new Set([
      ...page.folders.map((folder) => folder.owner_principal_id),
      ...page.conversations.map((conversation) => conversation.owner_principal_id),
    ]);
    if (owners.size > 1) {
      ctx.addIssue({ code: "custom", message: "Owner directory page 不能混合多个 owner。" });
    }
  });

const operationBase = {
  schema_version: z.literal("workspace-conversation-directory-command@1.0.0"),
  operation_id: immutableIdSchema,
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
} as const;

const versionedFolderBase = {
  ...operationBase,
  folder_id: immutableIdSchema,
  expected_resource_version: z.number().int().positive().safe(),
} as const;

const versionedConversationBase = {
  ...operationBase,
  conversation_id: immutableIdSchema,
  expected_resource_version: z.number().int().positive().safe(),
} as const;

export const workspaceConversationDirectoryActionSchema = z.enum([
  "FOLDER_CREATE",
  "FOLDER_RENAME",
  "FOLDER_REORDER",
  "FOLDER_ARCHIVE",
  "FOLDER_RESTORE",
  "FOLDER_DELETE",
  "CONVERSATION_RENAME",
  "CONVERSATION_REORDER",
  "CONVERSATION_MOVE",
  "CONVERSATION_ARCHIVE",
  "CONVERSATION_RESTORE",
  "CONVERSATION_TRASH",
  "CONVERSATION_RESTORE_FROM_TRASH",
]);

export const workspaceConversationDirectoryCommandDraftSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...operationBase,
    action: z.literal("FOLDER_CREATE"),
    folder_id: immutableIdSchema,
    name: workspaceConversationFolderSchema.shape.name,
    sort_order: z.number().int().nonnegative().safe(),
  }),
  z.strictObject({
    ...versionedFolderBase,
    action: z.literal("FOLDER_RENAME"),
    name: workspaceConversationFolderSchema.shape.name,
  }),
  z.strictObject({
    ...versionedFolderBase,
    action: z.literal("FOLDER_REORDER"),
    sort_order: z.number().int().nonnegative().safe(),
  }),
  z.strictObject({ ...versionedFolderBase, action: z.literal("FOLDER_ARCHIVE") }),
  z.strictObject({ ...versionedFolderBase, action: z.literal("FOLDER_RESTORE") }),
  z.strictObject({
    ...versionedFolderBase,
    action: z.literal("FOLDER_DELETE"),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    ...versionedConversationBase,
    action: z.literal("CONVERSATION_RENAME"),
    title: workspaceConversationV2Schema.shape.title,
  }),
  z.strictObject({
    ...versionedConversationBase,
    action: z.literal("CONVERSATION_REORDER"),
    sort_order: z.number().int().nonnegative().safe(),
  }),
  z.strictObject({
    ...versionedConversationBase,
    action: z.literal("CONVERSATION_MOVE"),
    folder_id: immutableIdSchema.nullable(),
  }),
  z.strictObject({ ...versionedConversationBase, action: z.literal("CONVERSATION_ARCHIVE") }),
  z.strictObject({ ...versionedConversationBase, action: z.literal("CONVERSATION_RESTORE") }),
  z.strictObject({
    ...versionedConversationBase,
    action: z.literal("CONVERSATION_TRASH"),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    ...versionedConversationBase,
    action: z.literal("CONVERSATION_RESTORE_FROM_TRASH"),
  }),
]);

export const workspaceConversationDirectoryCommandSchema = z.intersection(
  workspaceConversationDirectoryCommandDraftSchema,
  z.strictObject({ command_hash: contentHashSchema }).passthrough(),
);

export async function buildWorkspaceConversationDirectoryCommand(input: unknown) {
  const draft = workspaceConversationDirectoryCommandDraftSchema.parse(input);
  return deepFreeze(
    workspaceConversationDirectoryCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyWorkspaceConversationDirectoryCommand(input: unknown) {
  const command = workspaceConversationDirectoryCommandSchema.parse(input);
  const { command_hash: actual, ...draft } = command;
  const parsed = workspaceConversationDirectoryCommandDraftSchema.parse(draft);
  if ((await sha256ContentHash(parsed)) !== actual) {
    throw new TypeError("DIRECTORY_COMMAND_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

export const workspaceConversationDirectoryCommandResultSchema = z.strictObject({
  schema_version: z.literal("workspace-conversation-directory-command-result@1.0.0"),
  operation_id: immutableIdSchema,
  action: workspaceConversationDirectoryActionSchema,
  command_hash: contentHashSchema,
  replayed: z.boolean(),
  folder: workspaceConversationFolderSchema.nullable(),
  conversation: workspaceConversationV2Schema.nullable(),
  affected_conversation_ids: z.array(immutableIdSchema).max(500),
  committed_at: timestampSchema,
});

export const conversationTrashRetentionClaimSchema = z.strictObject({
  schema_version: z.literal("conversation-trash-retention-claim@1.0.0"),
  claim_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  owner_principal_id: immutableIdSchema,
  conversation_id: immutableIdSchema,
  deleted_at: timestampSchema,
  purge_after: timestampSchema,
  fence: z.number().int().positive().safe(),
  lease_expires_at: timestampSchema,
});

export const conversationTrashRetentionClaimInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(50),
  lease_duration_ms: z.number().int().min(1_000).max(300_000),
});

export const conversationTrashRetentionCompleteInputSchema = z.strictObject({
  schema_version: z.literal("conversation-trash-retention-complete@1.0.0"),
  claim_id: immutableIdSchema,
  fence: z.number().int().positive().safe(),
  outcome: z.enum(["PURGED", "HELD"]),
  reason_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
});

export const conversationTrashRetentionReceiptSchema = z.strictObject({
  schema_version: z.literal("conversation-trash-retention-receipt@1.0.0"),
  receipt_id: immutableIdSchema,
  claim_id: immutableIdSchema,
  conversation_id: immutableIdSchema,
  fence: z.number().int().positive().safe(),
  outcome: z.enum(["PURGED", "HELD"]),
  reason_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  committed_at: timestampSchema,
});

export type WorkspaceConversationDirectoryView = z.infer<
  typeof workspaceConversationDirectoryViewSchema
>;
export type WorkspaceConversationDirectoryQuery = z.infer<
  typeof workspaceConversationDirectoryQuerySchema
>;
export type WorkspaceConversationFolder = z.infer<typeof workspaceConversationFolderSchema>;
export type WorkspaceConversationV2 = z.infer<typeof workspaceConversationV2Schema>;
export type WorkspaceConversationDirectoryPage = z.infer<
  typeof workspaceConversationDirectoryPageSchema
>;
export type WorkspaceConversationDirectoryCommand = z.infer<
  typeof workspaceConversationDirectoryCommandSchema
>;
export type WorkspaceConversationDirectoryCommandDraft = z.infer<
  typeof workspaceConversationDirectoryCommandDraftSchema
>;
export type WorkspaceConversationDirectoryCommandResult = z.infer<
  typeof workspaceConversationDirectoryCommandResultSchema
>;
export type ConversationTrashRetentionClaim = z.infer<typeof conversationTrashRetentionClaimSchema>;
export type ConversationTrashRetentionClaimInput = z.infer<
  typeof conversationTrashRetentionClaimInputSchema
>;
export type ConversationTrashRetentionCompleteInput = z.infer<
  typeof conversationTrashRetentionCompleteInputSchema
>;
export type ConversationTrashRetentionReceipt = z.infer<
  typeof conversationTrashRetentionReceiptSchema
>;
