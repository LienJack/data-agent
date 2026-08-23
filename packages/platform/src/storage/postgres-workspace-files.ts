import {
  type JobWorkLease,
  type PortResult,
  type StorageRetentionPolicyRevision,
  type StorageRetentionPolicyUpdateCommand,
  verifyJobWorkLease,
  verifyStorageRetentionPolicyRevision,
  verifyStorageRetentionPolicyUpdateCommand,
  verifyWorkspaceContentGcEvaluationCommand,
  verifyWorkspaceContentGcReceipt,
  verifyWorkspaceFileDeleteCommand,
  verifyWorkspaceFileDeletionReceipt,
  verifyWorkspaceFileLegalHoldCommand,
  verifyWorkspaceFileLegalHoldReceipt,
  verifyWorkspaceFilePromoteCommand,
  verifyWorkspaceFileRevision,
  verifyWorkspaceFileScanReceipt,
  verifyWorkspaceFileUploadCommitCommand,
  type WorkspaceContentGcEvaluationCommand,
  type WorkspaceContentGcReceipt,
  type WorkspaceFileDeleteCommand,
  type WorkspaceFileDeletionReceipt,
  type WorkspaceFileLegalHoldCommand,
  type WorkspaceFileLegalHoldReceipt,
  type WorkspaceFilePromoteCommand,
  type WorkspaceFileScanReceipt,
  type WorkspaceFileUploadCommitCommand,
  workspaceContentGcCommitCommandSchema,
  workspaceContentGcEvaluationResultSchema,
  workspaceContentOrphanCheckCommandSchema,
  workspaceContentOrphanCheckResultSchema,
  workspaceFileDeletionResultSchema,
  workspaceFileDownloadAuthoritySchema,
  workspaceFileReferenceSchema,
  workspaceFileRevisionSchema,
  workspaceFileScanCommitResultSchema,
  workspaceFileScanCommitSchema,
  workspaceFileScanTargetSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

export interface PostgresWorkspaceFilesOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

const canonicalUuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

function invalid(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

function mapFileDatabaseFailure(error: unknown): PortResult<never> | null {
  const marker =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { readonly message?: unknown }).message)
      : "";
  const retryable = new Set([
    "WORKSPACE_FILE_REVISION_STALE",
    "WORKSPACE_FILE_SCAN_TARGET_STALE",
    "WORKSPACE_CONTENT_GC_STATE_STALE",
    "STORAGE_RETENTION_POLICY_REVISION_STALE",
  ]);
  if (
    /^WORKSPACE_(?:FILE|CONTENT)_[A-Z0-9_]+$/.test(marker) ||
    /^STORAGE_RETENTION_POLICY_[A-Z0-9_]+$/.test(marker)
  ) {
    return {
      ok: false,
      error: {
        code: marker,
        message: "Workspace File Authority 拒绝该请求。",
        retryable: retryable.has(marker),
      },
    };
  }
  return null;
}

function assertWorkspaceScope(workspaceId: string, tenantId: string): void {
  if (workspaceId !== tenantId) {
    throw new PersistenceBoundaryError(
      "WORKSPACE_FILE_SCOPE_MISMATCH",
      "Workspace File 请求不能替换服务端授权的 Workspace。",
    );
  }
}

async function verifyRevisionOrThrow(input: unknown) {
  try {
    return await verifyWorkspaceFileRevision(input);
  } catch {
    throw new PersistenceBoundaryError(
      "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
      "Workspace File 数据库 Revision 不符合契约。",
    );
  }
}

export function createPostgresWorkspaceFiles(options: PostgresWorkspaceFilesOptions) {
  return Object.freeze({
    async commitUpload(capabilityInput: unknown, commandInput: unknown) {
      let command: WorkspaceFileUploadCommitCommand;
      try {
        command = await verifyWorkspaceFileUploadCommitCommand(commandInput);
      } catch {
        return invalid("WORKSPACE_FILE_UPLOAD_COMMAND_INVALID", "上传提交命令不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_file.commit_upload",
          correlation_id: command.operation_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.commit_workspace_file_upload($1::jsonb) as value",
            [command],
          );
          const revision = await verifyRevisionOrThrow(query.rows[0]?.value);
          if (
            revision.file_id !== command.operation_id ||
            revision.owner_principal_id !== capability.principal ||
            revision.scope.tenant_id !== command.workspace_id ||
            revision.blob_hash !== command.observed_content.blob_hash ||
            revision.byte_size !== command.observed_content.byte_size ||
            revision.detected_mime !== command.observed_content.detected_mime ||
            revision.original_filename !== command.intent.original_filename ||
            revision.session_id !== command.intent.session_id ||
            revision.status !== "QUARANTINED"
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "上传 Revision 与请求身份不一致。",
            );
          }
          return revision;
        },
      );
    },

    async list(
      capabilityInput: unknown,
      input: Readonly<{ session_id?: string | null; limit?: number }>,
    ) {
      const session =
        input.session_id === undefined || input.session_id === null
          ? null
          : canonicalUuidSchema.safeParse(input.session_id);
      const limit = z
        .number()
        .int()
        .min(1)
        .max(200)
        .safeParse(input.limit ?? 100);
      if ((session !== null && !session.success) || !limit.success) {
        return invalid("WORKSPACE_FILE_LIST_INPUT_INVALID", "文件列表输入不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "workspace_file.list",
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.list_workspace_files($1::uuid,$2::integer) as value",
            [session === null ? null : session.data, limit.data],
          );
          const documents = z.array(workspaceFileRevisionSchema).parse(query.rows[0]?.value);
          return Promise.all(
            documents.map(async (document) => {
              const revision = await verifyRevisionOrThrow(document);
              if (revision.scope.tenant_id !== capability.scope.tenant_id) {
                throw new PersistenceBoundaryError(
                  "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
                  "列表结果越过当前 Workspace Scope。",
                );
              }
              return revision;
            }),
          );
        },
      );
    },

    async get(capabilityInput: unknown, referenceInput: unknown) {
      const reference = workspaceFileReferenceSchema.safeParse(referenceInput);
      if (!reference.success) {
        return invalid("WORKSPACE_FILE_REFERENCE_INVALID", "文件引用不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "workspace_file.get",
          correlation_id: reference.data.file_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.get_workspace_file($1::uuid,$2::bigint,$3::text) as value",
            [reference.data.file_id, reference.data.revision, reference.data.revision_hash],
          );
          if (query.rows[0]?.value === null || query.rows[0]?.value === undefined) return null;
          const revision = await verifyRevisionOrThrow(query.rows[0].value);
          if (
            revision.file_id !== reference.data.file_id ||
            revision.revision !== reference.data.revision ||
            revision.revision_hash !== reference.data.revision_hash ||
            revision.scope.tenant_id !== capability.scope.tenant_id
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "文件 Revision 与请求引用不一致。",
            );
          }
          return revision;
        },
      );
    },

    async resolveDownload(capabilityInput: unknown, referenceInput: unknown) {
      const reference = workspaceFileReferenceSchema.safeParse(referenceInput);
      if (!reference.success) {
        return invalid("WORKSPACE_FILE_REFERENCE_INVALID", "下载引用不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "workspace_file.resolve_download",
          correlation_id: reference.data.file_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.resolve_workspace_file_download($1::uuid,$2::bigint,$3::text) as value",
            [reference.data.file_id, reference.data.revision, reference.data.revision_hash],
          );
          const authority = workspaceFileDownloadAuthoritySchema.parse(query.rows[0]?.value);
          const file = await verifyRevisionOrThrow(authority.file);
          if (
            file.scope.tenant_id !== capability.scope.tenant_id ||
            file.file_id !== reference.data.file_id ||
            file.revision !== reference.data.revision ||
            file.revision_hash !== reference.data.revision_hash
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "下载 Authority 与 exact Revision 不一致。",
            );
          }
          return { ...authority, file };
        },
      );
    },

    async promote(capabilityInput: unknown, commandInput: unknown) {
      let command: WorkspaceFilePromoteCommand;
      try {
        command = await verifyWorkspaceFilePromoteCommand(commandInput);
      } catch {
        return invalid("WORKSPACE_FILE_PROMOTE_COMMAND_INVALID", "文件提升命令不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_file.promote",
          correlation_id: command.operation_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.promote_workspace_file($1::jsonb) as value",
            [command],
          );
          const revision = await verifyRevisionOrThrow(query.rows[0]?.value);
          if (
            revision.file_id !== command.file_ref.file_id ||
            revision.parent_ref?.revision_hash !== command.file_ref.revision_hash ||
            revision.visibility !== "WORKSPACE"
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "提升结果与源 Revision 不一致。",
            );
          }
          return revision;
        },
      );
    },

    async delete(capabilityInput: unknown, commandInput: unknown) {
      let command: WorkspaceFileDeleteCommand;
      try {
        command = await verifyWorkspaceFileDeleteCommand(commandInput);
      } catch {
        return invalid("WORKSPACE_FILE_DELETE_COMMAND_INVALID", "文件删除命令不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_file.delete",
          correlation_id: command.operation_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.delete_workspace_file($1::jsonb) as value",
            [command],
          );
          const result = workspaceFileDeletionResultSchema.parse(query.rows[0]?.value);
          const revision = await verifyRevisionOrThrow(result.revision);
          let receipt: WorkspaceFileDeletionReceipt;
          try {
            receipt = await verifyWorkspaceFileDeletionReceipt(result.deletion_receipt);
          } catch {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "删除回执 hash 无效。",
            );
          }
          if (
            revision.status !== "DELETED" ||
            revision.parent_ref?.revision_hash !== command.file_ref.revision_hash ||
            receipt.operation_id !== command.operation_id ||
            receipt.file_ref.revision_hash !== command.file_ref.revision_hash ||
            receipt.scope.tenant_id !== capability.scope.tenant_id ||
            revision.deletion_receipt_ref?.receipt_hash !== receipt.receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "删除结果的 Revision/Receipt closure 无效。",
            );
          }
          return { revision, deletion_receipt: receipt };
        },
      );
    },

    async setLegalHold(capabilityInput: unknown, commandInput: unknown) {
      let command: WorkspaceFileLegalHoldCommand;
      try {
        command = await verifyWorkspaceFileLegalHoldCommand(commandInput);
      } catch {
        return invalid("WORKSPACE_FILE_LEGAL_HOLD_COMMAND_INVALID", "Legal Hold 命令不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_file.legal_hold",
          correlation_id: command.operation_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.set_workspace_file_legal_hold($1::jsonb) as value",
            [command],
          );
          let receipt: WorkspaceFileLegalHoldReceipt;
          try {
            receipt = await verifyWorkspaceFileLegalHoldReceipt(query.rows[0]?.value);
          } catch {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "Legal Hold Receipt hash 无效。",
            );
          }
          if (
            receipt.scope.tenant_id !== capability.scope.tenant_id ||
            receipt.operation_id !== command.operation_id ||
            receipt.file_id !== command.file_id ||
            receipt.active !== command.active ||
            receipt.reason_code !== command.reason_code ||
            receipt.principal_id !== capability.principal
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "Legal Hold Receipt 与请求不一致。",
            );
          }
          return receipt;
        },
      );
    },

    async updateRetentionPolicy(capabilityInput: unknown, commandInput: unknown) {
      let command: StorageRetentionPolicyUpdateCommand;
      try {
        command = await verifyStorageRetentionPolicyUpdateCommand(commandInput);
      } catch {
        return invalid(
          "STORAGE_RETENTION_POLICY_COMMAND_INVALID",
          "Retention Policy 更新命令不符合契约。",
        );
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_content.retention_policy_update",
          correlation_id: command.operation_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.update_storage_retention_policy($1::jsonb) as value",
            [command],
          );
          let policy: StorageRetentionPolicyRevision;
          try {
            policy = await verifyStorageRetentionPolicyRevision(query.rows[0]?.value);
          } catch {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "Retention Policy Revision hash 无效。",
            );
          }
          if (
            policy.scope.tenant_id !== capability.scope.tenant_id ||
            policy.policy_id !== command.expected_policy_ref.policy_id ||
            policy.revision !== command.expected_policy_ref.policy_revision + 1 ||
            policy.parent_ref?.policy_hash !== command.expected_policy_ref.policy_hash ||
            policy.created_by_principal_id !== capability.principal
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "Retention Policy Revision 与 CAS 请求不一致。",
            );
          }
          return policy;
        },
      );
    },

    async evaluateGc(capabilityInput: unknown, commandInput: unknown) {
      let command: WorkspaceContentGcEvaluationCommand;
      try {
        command = await verifyWorkspaceContentGcEvaluationCommand(commandInput);
      } catch {
        return invalid("WORKSPACE_CONTENT_GC_COMMAND_INVALID", "GC Evaluation 命令不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_content.gc_evaluate",
          correlation_id: command.operation_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.evaluate_workspace_content_gc($1::jsonb) as value",
            [command],
          );
          const parsed = workspaceContentGcEvaluationResultSchema.parse(query.rows[0]?.value);
          let receipt: WorkspaceContentGcReceipt;
          try {
            receipt = await verifyWorkspaceContentGcReceipt(parsed.receipt);
          } catch {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "GC Evaluation Receipt hash 无效。",
            );
          }
          if (
            receipt.scope.tenant_id !== capability.scope.tenant_id ||
            receipt.operation_id !== command.operation_id ||
            receipt.blob_hash !== command.blob_hash ||
            (parsed.deletion_authority !== null &&
              parsed.deletion_authority.blob_hash !== command.blob_hash)
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "GC Evaluation 与 exact Scope/Blob 不一致。",
            );
          }
          return { receipt, deletion_authority: parsed.deletion_authority };
        },
      );
    },

    async commitGc(capabilityInput: unknown, commandInput: unknown) {
      const command = workspaceContentGcCommitCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return invalid("WORKSPACE_CONTENT_GC_COMMIT_INVALID", "GC Commit 命令不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_content.gc_commit",
          correlation_id: command.data.receipt_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.data.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.commit_workspace_content_gc($1::jsonb) as value",
            [command.data],
          );
          let receipt: WorkspaceContentGcReceipt;
          try {
            receipt = await verifyWorkspaceContentGcReceipt(query.rows[0]?.value);
          } catch {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "GC Commit Receipt hash 无效。",
            );
          }
          if (
            receipt.status !== "DELETED" ||
            receipt.scope.tenant_id !== capability.scope.tenant_id ||
            receipt.blob_hash !== command.data.blob_hash ||
            receipt.parent_receipt_ref?.receipt_id !== command.data.receipt_id ||
            receipt.parent_receipt_ref.receipt_hash !== command.data.receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "GC Commit 与 Eligible Receipt 不一致。",
            );
          }
          return receipt;
        },
      );
    },

    async classifyOrphan(capabilityInput: unknown, commandInput: unknown) {
      const command = workspaceContentOrphanCheckCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return invalid("WORKSPACE_CONTENT_ORPHAN_CHECK_INVALID", "Orphan 检查命令不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_content.orphan_check",
          correlation_id: command.data.blob_hash,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          assertWorkspaceScope(command.data.workspace_id, capability.scope.tenant_id);
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.classify_workspace_content_orphan($1::jsonb) as value",
            [command.data],
          );
          const result = workspaceContentOrphanCheckResultSchema.parse(query.rows[0]?.value);
          if (
            result.storage_key !== command.data.storage_key ||
            result.blob_hash !== command.data.blob_hash ||
            result.observed_at !== command.data.observed_at
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "Orphan 检查结果与 exact 对象身份不一致。",
            );
          }
          return result;
        },
      );
    },

    async loadForScan(capabilityInput: unknown, leaseInput: unknown) {
      let lease: JobWorkLease;
      try {
        lease = await verifyJobWorkLease(leaseInput);
      } catch {
        return invalid("WORKSPACE_FILE_SCAN_LEASE_INVALID", "FILE_SCAN Lease 不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_file.scan_load",
          correlation_id: lease.attempt_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (
            lease.scope.tenant_id !== capability.scope.tenant_id ||
            lease.principal_id !== capability.principal ||
            lease.kind !== "FILE_SCAN"
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_SCAN_LEASE_INVALID",
              "FILE_SCAN Lease 与当前 Authority 不一致。",
            );
          }
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.load_workspace_file_for_scan($1::jsonb) as value",
            [lease],
          );
          const target = workspaceFileScanTargetSchema.parse(query.rows[0]?.value);
          await verifyRevisionOrThrow(target.file);
          return target;
        },
      );
    },

    async commitScan(capabilityInput: unknown, leaseInput: unknown, commitInput: unknown) {
      let lease: JobWorkLease;
      try {
        lease = await verifyJobWorkLease(leaseInput);
      } catch {
        return invalid("WORKSPACE_FILE_SCAN_LEASE_INVALID", "FILE_SCAN Lease 不符合契约。");
      }
      const commit = workspaceFileScanCommitSchema.safeParse(commitInput);
      if (!commit.success) {
        return invalid("WORKSPACE_FILE_SCAN_COMMIT_INVALID", "FILE_SCAN Commit 不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "workspace_file.scan_commit",
          correlation_id: lease.attempt_id,
          map_database_error: mapFileDatabaseFailure,
        },
        async ({ capability, client }) => {
          if (
            lease.scope.tenant_id !== capability.scope.tenant_id ||
            lease.principal_id !== capability.principal ||
            lease.kind !== "FILE_SCAN"
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_SCAN_LEASE_INVALID",
              "FILE_SCAN Lease 与当前 Authority 不一致。",
            );
          }
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.commit_workspace_file_scan($1::jsonb,$2::jsonb) as value",
            [lease, commit.data],
          );
          const result = workspaceFileScanCommitResultSchema.parse(query.rows[0]?.value);
          const revision = await verifyRevisionOrThrow(result.revision);
          let receipt: WorkspaceFileScanReceipt;
          try {
            receipt = await verifyWorkspaceFileScanReceipt(result.scan_receipt);
          } catch {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "扫描回执 hash 无效。",
            );
          }
          if (
            receipt.job_id !== lease.job_id ||
            receipt.attempt_id !== lease.attempt_id ||
            receipt.worker_fence !== lease.worker_fence ||
            receipt.file_ref.revision_hash !== commit.data.file_ref.revision_hash ||
            receipt.blob_hash !== commit.data.blob_hash ||
            receipt.verdict !== commit.data.verdict ||
            revision.parent_ref?.revision_hash !== commit.data.file_ref.revision_hash ||
            revision.scan_receipt_ref?.receipt_hash !== receipt.receipt_hash
          ) {
            throw new PersistenceBoundaryError(
              "WORKSPACE_FILE_DATABASE_CONTRACT_INVALID",
              "FILE_SCAN 结果未闭合 exact Lease/Revision/Receipt。",
            );
          }
          return { scan_receipt: receipt, revision };
        },
      );
    },
  });
}

export type PostgresWorkspaceFiles = ReturnType<typeof createPostgresWorkspaceFiles>;
