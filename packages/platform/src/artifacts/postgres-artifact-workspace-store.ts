import {
  type ArtifactExportCommand,
  type ArtifactExportReceipt,
  artifactExportCommandSchema,
  artifactReferenceIdentity,
  type CreateArtifactExportResult,
  createArtifactExportResultSchema,
  type LoadArtifactExportCommand,
  loadArtifactExportCommandSchema,
  loadArtifactExportResultSchema,
  type PortResult,
  verifyArtifactExportReceipt,
} from "@data-agent/contracts";
import type { SqlPool } from "../persistence/transaction.js";
import { PersistenceBoundaryError, withAppTransaction } from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

export interface PostgresArtifactWorkspaceStoreOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}

function invalid(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const marker =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { readonly message?: unknown }).message)
      : "";
  const table: Record<string, { code: string; retryable: boolean }> = {
    DA_ARTIFACT_EXPORT_IDEMPOTENCY_CONFLICT: {
      code: "ARTIFACT_EXPORT_IDEMPOTENCY_CONFLICT",
      retryable: false,
    },
    DA_ARTIFACT_EXPORT_SOURCE_NOT_COMMITTED: {
      code: "ARTIFACT_EXPORT_SOURCE_NOT_COMMITTED",
      retryable: false,
    },
    DA_ARTIFACT_EXPORT_SCOPE_MISMATCH: {
      code: "ARTIFACT_EXPORT_SCOPE_MISMATCH",
      retryable: false,
    },
    DA_ARTIFACT_EXPORT_CONTRACT_INVALID: {
      code: "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID",
      retryable: false,
    },
  };
  const mapped = table[marker];
  return mapped
    ? {
        ok: false,
        error: {
          code: mapped.code,
          message: "Artifact Export Authority 拒绝该请求。",
          retryable: mapped.retryable,
        },
      }
    : null;
}

export function createPostgresArtifactWorkspaceStore(
  options: PostgresArtifactWorkspaceStoreOptions,
) {
  return {
    async create(
      capabilityInput: unknown,
      commandInput: unknown,
      receiptInput: unknown,
    ): Promise<PortResult<CreateArtifactExportResult>> {
      const command = artifactExportCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return invalid("ARTIFACT_EXPORT_COMMAND_INVALID", "Artifact Export Command 不符合契约。");
      }
      let receipt: ArtifactExportReceipt;
      try {
        receipt = await verifyArtifactExportReceipt(receiptInput, command.data);
      } catch {
        return invalid("ARTIFACT_EXPORT_RECEIPT_INVALID", "Artifact Export Receipt 不符合契约。");
      }

      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "artifact-export.create",
          map_database_error: databaseFailure,
        },
        async ({ client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.create_artifact_export_receipt($1::jsonb, $2::jsonb) as value",
            [command.data, receipt],
          );
          const parsed = createArtifactExportResultSchema.safeParse(query.rows[0]?.value);
          if (!parsed.success) {
            throw new PersistenceBoundaryError(
              "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID",
              "Artifact Export 数据库响应不符合契约。",
            );
          }
          try {
            await verifyArtifactExportReceipt(parsed.data.receipt, command.data);
          } catch {
            throw new PersistenceBoundaryError(
              "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID",
              "Artifact Export 数据库响应未通过 hash/source closure。",
            );
          }
          return parsed.data;
        },
      );
    },

    async load(
      capabilityInput: unknown,
      commandInput: unknown,
    ): Promise<PortResult<ArtifactExportReceipt | null>> {
      const command = loadArtifactExportCommandSchema.safeParse(commandInput);
      if (!command.success) {
        return invalid("ARTIFACT_EXPORT_LOAD_INVALID", "Artifact Export Load 输入不符合契约。");
      }
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "artifact-export.load",
          map_database_error: databaseFailure,
        },
        async ({ client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.load_artifact_export_receipt($1::jsonb) as value",
            [command.data],
          );
          const parsed = loadArtifactExportResultSchema.safeParse(query.rows[0]?.value);
          if (!parsed.success) {
            throw new PersistenceBoundaryError(
              "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID",
              "Artifact Export Load 数据库响应不符合契约。",
            );
          }
          if (!parsed.data.receipt) return null;
          let receipt: ArtifactExportReceipt;
          try {
            receipt = await verifyArtifactExportReceipt(parsed.data.receipt);
          } catch {
            throw new PersistenceBoundaryError(
              "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID",
              "Artifact Export Load receipt hash 无效。",
            );
          }
          if (
            artifactReferenceIdentity(receipt.receipt_ref) !==
              artifactReferenceIdentity(command.data.receipt_ref) ||
            artifactReferenceIdentity(receipt.source_ref) !==
              artifactReferenceIdentity(command.data.source_ref) ||
            receipt.output_hash !== command.data.output_hash
          ) {
            throw new PersistenceBoundaryError(
              "ARTIFACT_EXPORT_DATABASE_CONTRACT_INVALID",
              "Artifact Export Load receipt identity 与请求不一致。",
            );
          }
          return receipt;
        },
      );
    },
  };
}

export type PostgresArtifactWorkspaceStore = ReturnType<
  typeof createPostgresArtifactWorkspaceStore
>;
export type { ArtifactExportCommand, LoadArtifactExportCommand };
