import { createHash } from "node:crypto";
import {
  type CommitSensitiveExecutionArtifactResult,
  commitSensitiveExecutionArtifactCommandSchema,
  commitSensitiveExecutionArtifactResultSchema,
  effectiveConfigRunLeasePayloadSchema,
  loadSensitiveExecutionArtifactCommandSchema,
  loadSensitiveExecutionArtifactResultSchema,
  type PortResult,
  runWorkLeaseSchema,
  type SensitiveExecutionArtifactReceipt,
  verifySensitiveExecutionArtifactReceipt,
} from "@data-agent/contracts";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

export interface PrivateCiphertextBlobStore {
  putIfAbsent(contentHash: string, bytes: Uint8Array): Promise<void>;
  get(contentHash: string): Promise<Uint8Array | null>;
}

export interface SensitiveExecutionArtifactAuthorityOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly blobs: PrivateCiphertextBlobStore;
}

function invalid(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

function cipherHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function mapDatabaseError(error: unknown): PortResult<never> | null {
  const message = error instanceof Error ? error.message : "";
  for (const marker of [
    "SENSITIVE_EXECUTION_ARTIFACT_CONTRACT_INVALID",
    "SENSITIVE_EXECUTION_ARTIFACT_SCOPE_MISMATCH",
    "SENSITIVE_EXECUTION_ARTIFACT_IDEMPOTENCY_CONFLICT",
    "SENSITIVE_EXECUTION_ARTIFACT_TOMBSTONED",
  ]) {
    if (message.includes(marker))
      return invalid(marker, "Sensitive Artifact Authority 拒绝该请求。");
  }
  return null;
}

export function createSensitiveExecutionArtifactAuthority(
  options: SensitiveExecutionArtifactAuthorityOptions,
) {
  return {
    async commit(
      capabilityInput: unknown,
      input: {
        readonly command: unknown;
        readonly lease: unknown;
        readonly ciphertext: Uint8Array;
      },
    ): Promise<PortResult<CommitSensitiveExecutionArtifactResult>> {
      const command = commitSensitiveExecutionArtifactCommandSchema.safeParse(input.command);
      if (!command.success)
        return invalid(
          "SENSITIVE_EXECUTION_ARTIFACT_COMMAND_INVALID",
          "Sensitive artifact command 无效。",
        );
      const lease = runWorkLeaseSchema
        .extend({ payload: effectiveConfigRunLeasePayloadSchema })
        .safeParse(input.lease);
      if (!lease.success)
        return invalid(
          "SENSITIVE_EXECUTION_ARTIFACT_LEASE_INVALID",
          "Sensitive artifact lease 无效。",
        );
      let verified: SensitiveExecutionArtifactReceipt;
      try {
        verified = await verifySensitiveExecutionArtifactReceipt(command.data.receipt);
      } catch {
        return invalid(
          "SENSITIVE_EXECUTION_ARTIFACT_RECEIPT_INVALID",
          "Sensitive artifact receipt 无效。",
        );
      }
      if (cipherHash(input.ciphertext) !== verified.ciphertext_hash) {
        return invalid(
          "SENSITIVE_EXECUTION_ARTIFACT_CIPHERTEXT_INVALID",
          "Ciphertext hash 不匹配。",
        );
      }
      await options.blobs.putIfAbsent(verified.ciphertext_hash, input.ciphertext);
      return withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "WRITE",
          operation_name: "agent-team.sensitive-artifact.commit",
          correlation_id: verified.artifact_ref.artifact_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.commit_sensitive_execution_artifact($1::jsonb,$2::jsonb) as value",
            [lease.data, command.data],
          );
          const parsed = commitSensitiveExecutionArtifactResultSchema.safeParse(
            query.rows[0]?.value,
          );
          if (!parsed.success)
            throw new PersistenceBoundaryError(
              "SENSITIVE_EXECUTION_ARTIFACT_DATABASE_CONTRACT_INVALID",
              "Sensitive artifact DB response 无效。",
              false,
            );
          const returned = await verifySensitiveExecutionArtifactReceipt(parsed.data.receipt);
          if (returned.receipt_hash !== verified.receipt_hash) {
            throw new PersistenceBoundaryError(
              "SENSITIVE_EXECUTION_ARTIFACT_DATABASE_CONTRACT_INVALID",
              "Sensitive artifact receipt 被替换。",
              false,
            );
          }
          return parsed.data;
        },
      );
    },

    async load(capabilityInput: unknown, commandInput: unknown) {
      const command = loadSensitiveExecutionArtifactCommandSchema.safeParse(commandInput);
      if (!command.success)
        return invalid(
          "SENSITIVE_EXECUTION_ARTIFACT_LOAD_INVALID",
          "Sensitive artifact load command 无效。",
        );
      const metadata = await withAppTransaction(
        options.pool,
        options.authorizer,
        capabilityInput,
        {
          access: "READ",
          operation_name: "agent-team.sensitive-artifact.load",
          correlation_id: command.data.artifact_ref.artifact_id,
          map_database_error: mapDatabaseError,
        },
        async ({ client }) => {
          const query = await client.query<{ readonly value: unknown }>(
            "select app_data_agent.load_sensitive_execution_artifact($1::jsonb) as value",
            [command.data],
          );
          const parsed = loadSensitiveExecutionArtifactResultSchema.safeParse(query.rows[0]?.value);
          if (!parsed.success)
            throw new PersistenceBoundaryError(
              "SENSITIVE_EXECUTION_ARTIFACT_DATABASE_CONTRACT_INVALID",
              "Sensitive artifact load response 无效。",
              false,
            );
          if (!parsed.data.receipt) return null;
          const receipt = await verifySensitiveExecutionArtifactReceipt(parsed.data.receipt);
          if (
            receipt.receipt_hash !== parsed.data.receipt.receipt_hash ||
            receipt.ciphertext_hash !== command.data.ciphertext_hash
          ) {
            throw new PersistenceBoundaryError(
              "SENSITIVE_EXECUTION_ARTIFACT_DATABASE_CONTRACT_INVALID",
              "Sensitive artifact load identity 不匹配。",
              false,
            );
          }
          return receipt;
        },
      );
      if (!metadata.ok || metadata.value === null) return metadata;
      const bytes = await options.blobs.get(metadata.value.ciphertext_hash);
      if (!bytes || cipherHash(bytes) !== metadata.value.ciphertext_hash) {
        return invalid(
          "SENSITIVE_EXECUTION_ARTIFACT_BLOB_INVALID",
          "Sensitive artifact blob 缺失或 hash 不匹配。",
        );
      }
      return { ok: true as const, value: { receipt: metadata.value, ciphertext: bytes } };
    },
  };
}

export type SensitiveExecutionArtifactAuthority = ReturnType<
  typeof createSensitiveExecutionArtifactAuthority
>;
