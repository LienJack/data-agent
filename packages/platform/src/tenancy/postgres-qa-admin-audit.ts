import {
  type PortResult,
  type QaAdminArtifactAccessResult,
  type QaAdminConversationPage,
  type QaAdminDirectoryPage,
  type QaAdminRunEventsPage,
  qaAdminArtifactAccessQuerySchema,
  qaAdminArtifactAccessResultSchema,
  qaAdminAuditReceiptRefSchema,
  qaAdminConversationPageSchema,
  qaAdminConversationQuerySchema,
  qaAdminDirectoryPageSchema,
  qaAdminDirectoryQuerySchema,
  qaAdminRunEventsPageSchema,
  qaAdminRunEventsQuerySchema,
  runRuntimeEventSchema,
  toPublicRunEvent,
} from "@data-agent/contracts";
import { z } from "zod";
import { projectArtifactDocument } from "../artifacts/artifact-workspace-service.js";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "./transactional-authority.internal.js";

interface JsonResultRow {
  readonly result: unknown;
}

const { preview: _preview, ...rawArtifactAccessResultFields } =
  qaAdminArtifactAccessResultSchema.shape;
const rawArtifactAccessResultSchema = z.strictObject({
  ...rawArtifactAccessResultFields,
  artifact_document: z.unknown(),
});

const rawEventPageSchema = z.strictObject({
  schema_version: z.literal("qa-admin-run-events-raw-page@1.0.0"),
  workspace_id: z.uuid(),
  owner_principal_id: z.uuid(),
  conversation_id: z.uuid(),
  run_id: z.uuid().nullable(),
  read_only: z.literal(true),
  event_documents: z.array(runRuntimeEventSchema).max(10_000),
  next_sequence: z.number().int().nonnegative().safe().nullable(),
  receipt: qaAdminAuditReceiptRefSchema,
});

function invalid<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

function unavailable<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: true } };
}

function mapQaAdminDatabaseFailure(error: unknown): PortResult<never> | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  const marker = typeof candidate.message === "string" ? candidate.message : "";
  if (marker === "QA_ADMIN_AUDIT_UNAVAILABLE") {
    return unavailable(
      "QA_ADMIN_AUDIT_UNAVAILABLE",
      "管理员审计回执暂时无法写入，未返回任何资源内容。",
    );
  }
  if (marker === "QA_ADMIN_ACCESS_DENIED" || candidate.code === "42501") {
    return invalid("QA_ADMIN_ACCESS_DENIED", "当前身份无权访问对话审计平面。");
  }
  if (marker === "QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED" || candidate.code === "P0002") {
    return invalid("QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED", "资源不存在或无权审计。");
  }
  if (marker === "QA_ADMIN_QUERY_INVALID" || candidate.code === "22023") {
    return invalid("QA_ADMIN_QUERY_INVALID", "管理员审计查询不符合严格契约。");
  }
  return null;
}

export function createPostgresQaAdminAuditRepository(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
) {
  const transactionOptions = {
    map_database_error: mapQaAdminDatabaseFailure,
  } as const;

  return Object.freeze({
    async readDirectory(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<QaAdminDirectoryPage>> {
      const parsed = qaAdminDirectoryQuerySchema.safeParse(input);
      if (!parsed.success) return invalid("QA_ADMIN_QUERY_INVALID", "管理员目录查询不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER"],
          operation_name: "workspace.qa.admin.directory.read",
          ...transactionOptions,
        },
        async ({ client, capability }) => {
          if (parsed.data.workspace_id !== capability.scope.tenant_id) {
            throw new PersistenceBoundaryError(
              "QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED",
              "资源不存在或无权审计。",
            );
          }
          const result = await client.query<JsonResultRow>(
            "select app_data_agent.read_qa_admin_directory($1::jsonb) as result",
            [parsed.data],
          );
          return qaAdminDirectoryPageSchema.parse(result.rows[0]?.result);
        },
      );
    },

    async readConversation(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<QaAdminConversationPage>> {
      const parsed = qaAdminConversationQuerySchema.safeParse(input);
      if (!parsed.success) return invalid("QA_ADMIN_QUERY_INVALID", "管理员对话查询不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER"],
          operation_name: "workspace.qa.admin.conversation.read",
          ...transactionOptions,
        },
        async ({ client, capability }) => {
          if (parsed.data.workspace_id !== capability.scope.tenant_id) {
            throw new PersistenceBoundaryError(
              "QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED",
              "资源不存在或无权审计。",
            );
          }
          const result = await client.query<JsonResultRow>(
            "select app_data_agent.read_qa_admin_conversation($1::jsonb) as result",
            [parsed.data],
          );
          return qaAdminConversationPageSchema.parse(result.rows[0]?.result);
        },
      );
    },

    async readRunEvents(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<QaAdminRunEventsPage>> {
      const parsed = qaAdminRunEventsQuerySchema.safeParse(input);
      if (!parsed.success) return invalid("QA_ADMIN_QUERY_INVALID", "管理员 Run 查询不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER"],
          operation_name: "workspace.qa.admin.run.read",
          ...transactionOptions,
        },
        async ({ client, capability }) => {
          if (parsed.data.workspace_id !== capability.scope.tenant_id) {
            throw new PersistenceBoundaryError(
              "QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED",
              "资源不存在或无权审计。",
            );
          }
          const result = await client.query<JsonResultRow>(
            "select app_data_agent.read_qa_admin_run_events($1::jsonb) as result",
            [parsed.data],
          );
          const raw = rawEventPageSchema.parse(result.rows[0]?.result);
          return qaAdminRunEventsPageSchema.parse({
            schema_version: "qa-admin-run-events-page@1.0.0",
            workspace_id: raw.workspace_id,
            owner_principal_id: raw.owner_principal_id,
            conversation_id: raw.conversation_id,
            run_id: raw.run_id,
            read_only: true,
            events: raw.event_documents.map(toPublicRunEvent),
            next_sequence: raw.next_sequence,
            receipt: raw.receipt,
          });
        },
      );
    },

    async authorizeArtifactAccess(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<QaAdminArtifactAccessResult>> {
      const parsed = qaAdminArtifactAccessQuerySchema.safeParse(input);
      if (!parsed.success)
        return invalid("QA_ADMIN_QUERY_INVALID", "管理员 Artifact 查询不符合契约。");
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        {
          access: "READ",
          allowed_roles: ["OWNER"],
          operation_name: "workspace.qa.admin.artifact.read",
          ...transactionOptions,
        },
        async ({ client, capability }) => {
          if (parsed.data.workspace_id !== capability.scope.tenant_id) {
            throw new PersistenceBoundaryError(
              "QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED",
              "资源不存在或无权审计。",
            );
          }
          const result = await client.query<JsonResultRow>(
            "select app_data_agent.authorize_qa_admin_artifact_access($1::jsonb) as result",
            [parsed.data],
          );
          const raw = rawArtifactAccessResultSchema.parse(result.rows[0]?.result);
          const preview =
            parsed.data.operation === "ARTIFACT_PREVIEW"
              ? await projectArtifactDocument(raw.artifact_document, raw.reference, {
                  offset: 0,
                  limit: 200,
                })
              : null;
          const { artifact_document: _artifactDocument, ...publicResult } = raw;
          return qaAdminArtifactAccessResultSchema.parse({ ...publicResult, preview });
        },
      );
    },
  });
}

export type PostgresQaAdminAuditRepository = ReturnType<
  typeof createPostgresQaAdminAuditRepository
>;
