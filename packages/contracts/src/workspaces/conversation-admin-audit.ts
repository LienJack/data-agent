import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import { artifactPreviewResultSchema } from "../artifacts/export-receipt.js";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { publicRunEventSchema } from "../runs/public-events.js";
import {
  workspaceConversationFolderSchema,
  workspaceConversationLifecycleSchema,
  workspaceConversationLiveStateSchema,
  workspaceConversationV2Schema,
} from "./conversation-directory.js";
import { workspaceConversationMessageSchema } from "./data-isolation.js";

export const qaAdminAuditActorRoleSchema = z.enum(["WORKSPACE_ADMIN", "SUPER_ADMIN"]);
export const qaAdminAuditOperationSchema = z.enum([
  "DIRECTORY_READ",
  "CONVERSATION_READ",
  "MESSAGES_READ",
  "RUN_REPLAY",
  "TRAJECTORY_READ",
  "SUBAGENT_READ",
  "ARTIFACT_PREVIEW",
  "ARTIFACT_EXPORT",
]);
export const qaAdminAuditReasonCodeSchema = z.enum([
  "QA_ADMIN_DIRECTORY_REVIEW",
  "QA_ADMIN_CONVERSATION_REVIEW",
  "QA_ADMIN_MESSAGE_REVIEW",
  "QA_ADMIN_RUN_REPLAY",
  "QA_ADMIN_TRAJECTORY_REVIEW",
  "QA_ADMIN_SUBAGENT_REVIEW",
  "QA_ADMIN_ARTIFACT_PREVIEW",
  "QA_ADMIN_ARTIFACT_EXPORT",
]);

const operationReasonPairs = new Map<
  z.infer<typeof qaAdminAuditOperationSchema>,
  z.infer<typeof qaAdminAuditReasonCodeSchema>
>([
  ["DIRECTORY_READ", "QA_ADMIN_DIRECTORY_REVIEW"],
  ["CONVERSATION_READ", "QA_ADMIN_CONVERSATION_REVIEW"],
  ["MESSAGES_READ", "QA_ADMIN_MESSAGE_REVIEW"],
  ["RUN_REPLAY", "QA_ADMIN_RUN_REPLAY"],
  ["TRAJECTORY_READ", "QA_ADMIN_TRAJECTORY_REVIEW"],
  ["SUBAGENT_READ", "QA_ADMIN_SUBAGENT_REVIEW"],
  ["ARTIFACT_PREVIEW", "QA_ADMIN_ARTIFACT_PREVIEW"],
  ["ARTIFACT_EXPORT", "QA_ADMIN_ARTIFACT_EXPORT"],
]);

export const qaAdminAuditReceiptRefSchema = z.strictObject({
  schema_version: z.literal("qa-admin-audit-receipt-ref@1.0.0"),
  receipt_id: immutableIdSchema,
  operation: qaAdminAuditOperationSchema,
  reason_code: qaAdminAuditReasonCodeSchema,
  request_digest: contentHashSchema,
  occurred_at: timestampSchema,
});

const queryTextSchema = z.string().trim().min(1).max(120).nullable();
const cursorSchema = z.string().min(1).max(2_048).nullable();

export const qaAdminDirectoryQuerySchema = z.strictObject({
  schema_version: z.literal("qa-admin-directory-query@1.0.0"),
  workspace_id: immutableIdSchema,
  owner_principal_id: immutableIdSchema.nullable(),
  folder_id: immutableIdSchema.nullable(),
  lifecycle: workspaceConversationLifecycleSchema.nullable(),
  live_state: workspaceConversationLiveStateSchema.nullable(),
  query: queryTextSchema,
  cursor: cursorSchema,
  limit: z.number().int().min(1).max(50),
});

export const qaAdminDirectoryPageSchema = z
  .strictObject({
    schema_version: z.literal("qa-admin-directory-page@1.0.0"),
    workspace_id: immutableIdSchema,
    read_only: z.literal(true),
    folders: z.array(workspaceConversationFolderSchema).max(500),
    conversations: z.array(workspaceConversationV2Schema).max(500),
    next_cursor: cursorSchema,
    receipt: qaAdminAuditReceiptRefSchema,
  })
  .superRefine((page, ctx) => {
    if (page.receipt.operation !== "DIRECTORY_READ") {
      ctx.addIssue({ code: "custom", message: "Admin directory receipt operation 不一致。" });
    }
    for (const [index, folder] of page.folders.entries()) {
      if (folder.workspace_id !== page.workspace_id) {
        ctx.addIssue({
          code: "custom",
          message: "Admin folder workspace scope 不一致。",
          path: ["folders", index, "workspace_id"],
        });
      }
    }
    for (const [index, conversation] of page.conversations.entries()) {
      if (conversation.workspace_id !== page.workspace_id) {
        ctx.addIssue({
          code: "custom",
          message: "Admin conversation workspace scope 不一致。",
          path: ["conversations", index, "workspace_id"],
        });
      }
    }
  });

export const qaAdminConversationQuerySchema = z.strictObject({
  schema_version: z.literal("qa-admin-conversation-query@1.0.0"),
  operation: z.enum(["CONVERSATION_READ", "MESSAGES_READ"]),
  workspace_id: immutableIdSchema,
  owner_principal_id: immutableIdSchema,
  conversation_id: immutableIdSchema,
  cursor: cursorSchema,
  limit: z.number().int().min(1).max(200),
});

export const qaAdminConversationPageSchema = z
  .strictObject({
    schema_version: z.literal("qa-admin-conversation-page@1.0.0"),
    workspace_id: immutableIdSchema,
    owner_principal_id: immutableIdSchema,
    read_only: z.literal(true),
    conversation: workspaceConversationV2Schema,
    messages: z.array(workspaceConversationMessageSchema).max(200),
    next_cursor: cursorSchema,
    receipt: qaAdminAuditReceiptRefSchema,
  })
  .superRefine((page, ctx) => {
    if (
      page.conversation.workspace_id !== page.workspace_id ||
      page.conversation.owner_principal_id !== page.owner_principal_id
    ) {
      ctx.addIssue({ code: "custom", message: "Admin conversation identity closure 不一致。" });
    }
    if (
      !(["CONVERSATION_READ", "MESSAGES_READ"] as const).includes(page.receipt.operation as never)
    ) {
      ctx.addIssue({ code: "custom", message: "Admin conversation receipt operation 不一致。" });
    }
    for (const [index, message] of page.messages.entries()) {
      if (
        message.workspace_id !== page.workspace_id ||
        message.conversation_id !== page.conversation.conversation_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Admin message identity closure 不一致。",
          path: ["messages", index],
        });
      }
    }
  });

export const qaAdminRunEventsQuerySchema = z
  .strictObject({
    schema_version: z.literal("qa-admin-run-events-query@1.0.0"),
    operation: z.enum(["RUN_REPLAY", "TRAJECTORY_READ", "SUBAGENT_READ"]),
    workspace_id: immutableIdSchema,
    owner_principal_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    run_id: immutableIdSchema.nullable(),
    profile_id: versionIdentifierSchema.nullable(),
    task_id: immutableIdSchema.nullable(),
    after_sequence: z.number().int().nonnegative().safe(),
    limit: z.number().int().min(1).max(500),
  })
  .superRefine((query, ctx) => {
    if (query.operation === "RUN_REPLAY" && query.run_id === null) {
      ctx.addIssue({ code: "custom", message: "Run replay 必须绑定 run_id。", path: ["run_id"] });
    }
    if (
      query.operation === "SUBAGENT_READ" &&
      (query.run_id === null || query.profile_id === null || query.task_id === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Subagent read 必须绑定 run/profile/task identity。",
      });
    }
    if (
      query.operation !== "SUBAGENT_READ" &&
      (query.profile_id !== null || query.task_id !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "非 Subagent read 不得携带 profile/task identity。",
      });
    }
  });

export const qaAdminRunEventsPageSchema = z
  .strictObject({
    schema_version: z.literal("qa-admin-run-events-page@1.0.0"),
    workspace_id: immutableIdSchema,
    owner_principal_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    run_id: immutableIdSchema.nullable(),
    read_only: z.literal(true),
    events: z.array(publicRunEventSchema).max(10_000),
    next_sequence: z.number().int().nonnegative().safe().nullable(),
    receipt: qaAdminAuditReceiptRefSchema,
  })
  .superRefine((page, ctx) => {
    if (
      !(["RUN_REPLAY", "TRAJECTORY_READ", "SUBAGENT_READ"] as const).includes(
        page.receipt.operation as never,
      )
    ) {
      ctx.addIssue({ code: "custom", message: "Admin run receipt operation 不一致。" });
    }
    for (const [index, event] of page.events.entries()) {
      if (page.run_id !== null && event.run_id !== page.run_id) {
        ctx.addIssue({
          code: "custom",
          message: "Admin event run identity closure 不一致。",
          path: ["events", index, "run_id"],
        });
      }
    }
  });

export const qaAdminArtifactAccessQuerySchema = z
  .strictObject({
    schema_version: z.literal("qa-admin-artifact-access-query@1.0.0"),
    operation: z.enum(["ARTIFACT_PREVIEW", "ARTIFACT_EXPORT"]),
    workspace_id: immutableIdSchema,
    owner_principal_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    run_id: immutableIdSchema,
    reference: artifactReferenceSchema,
  })
  .superRefine((query, ctx) => {
    if (
      query.reference.run_id !== query.run_id ||
      query.reference.tenant_id !== query.workspace_id
    ) {
      ctx.addIssue({ code: "custom", message: "Admin artifact scope identity closure 不一致。" });
    }
  });

export const qaAdminArtifactAccessResultSchema = z
  .strictObject({
    schema_version: z.literal("qa-admin-artifact-access-result@1.0.0"),
    workspace_id: immutableIdSchema,
    owner_principal_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    run_id: immutableIdSchema,
    read_only: z.literal(true),
    reference: artifactReferenceSchema,
    preview: artifactPreviewResultSchema.nullable(),
    receipt: qaAdminAuditReceiptRefSchema,
  })
  .superRefine((result, ctx) => {
    if (result.reference.run_id !== result.run_id) {
      ctx.addIssue({ code: "custom", message: "Admin artifact run identity closure 不一致。" });
    }
    if (
      !(["ARTIFACT_PREVIEW", "ARTIFACT_EXPORT"] as const).includes(
        result.receipt.operation as never,
      )
    ) {
      ctx.addIssue({ code: "custom", message: "Admin artifact receipt operation 不一致。" });
    }
  });

export function qaAdminReasonForOperation(
  operation: z.infer<typeof qaAdminAuditOperationSchema>,
): z.infer<typeof qaAdminAuditReasonCodeSchema> {
  const reason = operationReasonPairs.get(operation);
  if (!reason) throw new TypeError("QA_ADMIN_OPERATION_UNSUPPORTED");
  return reason;
}

export type QaAdminAuditReceiptRef = z.infer<typeof qaAdminAuditReceiptRefSchema>;
export type QaAdminDirectoryQuery = z.infer<typeof qaAdminDirectoryQuerySchema>;
export type QaAdminDirectoryPage = z.infer<typeof qaAdminDirectoryPageSchema>;
export type QaAdminConversationQuery = z.infer<typeof qaAdminConversationQuerySchema>;
export type QaAdminConversationPage = z.infer<typeof qaAdminConversationPageSchema>;
export type QaAdminRunEventsQuery = z.infer<typeof qaAdminRunEventsQuerySchema>;
export type QaAdminRunEventsPage = z.infer<typeof qaAdminRunEventsPageSchema>;
export type QaAdminArtifactAccessQuery = z.infer<typeof qaAdminArtifactAccessQuerySchema>;
export type QaAdminArtifactAccessResult = z.infer<typeof qaAdminArtifactAccessResultSchema>;
