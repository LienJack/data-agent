import { createCipheriv, createHash, createHmac } from "node:crypto";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  buildAnalysisInputMaterializationReceipt,
  buildSensitiveExecutionArtifactReceipt,
  type CommitSensitiveExecutionArtifactResult,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, type PortResult, sha256ContentHash } from "@data-agent/contracts/common";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import type { AnalysisArtifactCommitPort } from "./executor.js";
import {
  type GovernedAnalysisInput,
  verifyProductTeamQueryEvidenceInput,
} from "./governed-analysis-input.js";

const INPUT_KEY_ENV = "DATA_AGENT_ANALYSIS_INPUT_KEY_BASE64" as const;
const INPUT_KEY_ID_ENV = "DATA_AGENT_ANALYSIS_INPUT_KEY_ID" as const;
const DEFAULT_INPUT_KEY_ID = "analysis-input-v1" as const;
const MATERIALIZER_VERSION = "analysis-arrow-materializer@3.0.0" as const;
const CIPHERTEXT_MAGIC = Buffer.from("DAAI1", "ascii");
const PRIMARY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const BACKUP_RETENTION_MS = 37 * 24 * 60 * 60 * 1_000;

export interface AnalysisInputSensitiveArtifactAuthority {
  commit(
    capabilityInput: unknown,
    input: {
      readonly command: unknown;
      readonly lease: unknown;
      readonly ciphertext: Uint8Array;
    },
  ): Promise<PortResult<CommitSensitiveExecutionArtifactResult>>;
}

export interface AnalysisInputProductArtifactAuthority {
  resolveCommitted(
    capabilityInput: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
}

export interface AnalysisInputMaterializationCommand {
  readonly lease: RunWorkLease;
  readonly analysis_program_ref: ArtifactReference;
  readonly node_id: string;
  readonly idempotency_key: string;
  readonly input_name: string;
  readonly format: "ARROW";
  readonly content: Uint8Array;
  readonly row_count: number;
  readonly columns: readonly {
    readonly name: string;
    readonly arrow_type: "UTF8" | "FLOAT64" | "BOOL" | "DATE32" | "TIMESTAMP_MS";
    readonly nullable: boolean;
    readonly semantic_role: "METRIC" | "DIMENSION";
    readonly semantic_object_id: string;
  }[];
  readonly source_binding_hash: `sha256:${string}`;
  readonly spec_hash: `sha256:${string}`;
  readonly snapshot_receipt_hash: `sha256:${string}`;
  readonly query_evidence_ref: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
}

function byteHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function leaseStartedAt(lease: RunWorkLease): Date {
  const value = Date.parse(lease.expires_at) - lease.lease_duration_ms;
  if (!Number.isFinite(value)) throw new TypeError("ANALYSIS_INPUT_LEASE_TIME_INVALID");
  return new Date(value);
}

function inputAad(
  input: AnalysisInputMaterializationCommand,
  plaintextHash: string,
  source: { readonly result_hash: string; readonly row_count: number },
): Uint8Array {
  return Buffer.from(
    canonicalizeJson({
      protocol_version: "analysis-input-aad@3.0.0",
      scope: input.lease.scope,
      run_id: input.lease.run_id,
      analysis_program_ref: input.analysis_program_ref,
      node_id: input.node_id,
      query_evidence_ref: input.query_evidence_ref,
      input_name: input.input_name,
      source_result_hash: source.result_hash,
      source_binding_hash: input.source_binding_hash,
      source_row_count: source.row_count,
      columns: input.columns,
      plaintext_hash: plaintextHash,
      spec_hash: input.spec_hash,
      snapshot_receipt_hash: input.snapshot_receipt_hash,
    }),
    "utf8",
  );
}

function encryptInput(input: {
  readonly plaintext: Uint8Array;
  readonly key: Uint8Array;
  readonly aad: Uint8Array;
}): Uint8Array {
  if (input.key.byteLength !== 32) {
    throw new TypeError("ANALYSIS_INPUT_ENCRYPTION_CONFIG_INVALID");
  }
  const iv = createHmac("sha256", input.key)
    .update("analysis-input-iv@1.0.0\0", "utf8")
    .update(input.aad)
    .digest()
    .subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", input.key, iv);
  cipher.setAAD(input.aad);
  const encrypted = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
  return Buffer.concat([CIPHERTEXT_MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function resolveAnalysisInputEncryption(
  environment: NodeJS.ProcessEnv,
): { readonly key: Uint8Array; readonly key_id: string } | null {
  const encoded = environment[INPUT_KEY_ENV]?.trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    throw new TypeError("ANALYSIS_INPUT_ENCRYPTION_CONFIG_INVALID");
  }
  return {
    key,
    key_id: environment[INPUT_KEY_ID_ENV]?.trim() || DEFAULT_INPUT_KEY_ID,
  };
}

export function createAnalysisInputMaterializer(input: {
  readonly sensitive_artifacts: AnalysisInputSensitiveArtifactAuthority;
  readonly product_artifacts: AnalysisInputProductArtifactAuthority;
  readonly analysis_artifacts: AnalysisArtifactCommitPort;
  readonly capability_input: unknown;
  readonly encryption_key: Uint8Array;
  readonly encryption_key_id: string;
}) {
  if (input.encryption_key.byteLength !== 32) {
    throw new TypeError("ANALYSIS_INPUT_ENCRYPTION_CONFIG_INVALID");
  }
  return Object.freeze({
    async materialize(
      command: AnalysisInputMaterializationCommand,
    ): Promise<GovernedAnalysisInput> {
      if (command.content.byteLength === 0 || command.content.byteLength > 16 * 1024 * 1024) {
        throw new TypeError("ANALYSIS_INPUT_BYTE_BUDGET_EXCEEDED");
      }
      const resolved = await input.product_artifacts.resolveCommitted(
        input.capability_input,
        command.query_evidence_ref,
      );
      if (!resolved.ok || !resolved.value) {
        throw new TypeError(
          resolved.ok ? "ANALYSIS_INPUT_QUERY_EVIDENCE_NOT_COMMITTED" : resolved.error.code,
        );
      }
      const queryEvidence = await verifyProductTeamQueryEvidenceInput({
        query_evidence_ref: command.query_evidence_ref,
        query_evidence_document: resolved.value,
        arrow_content: command.content,
        expected_row_count: command.row_count,
        expected_ordered_columns: command.columns.map(({ name }) => name),
      });
      if (
        command.analysis_program_ref.run_id !== command.lease.run_id ||
        command.analysis_program_ref.app_id !== command.lease.scope.app_id ||
        command.analysis_program_ref.tenant_id !== command.lease.scope.tenant_id ||
        command.analysis_program_ref.environment !== command.lease.scope.environment ||
        command.source_binding_hash !== queryEvidence.semantic_binding.binding_hash ||
        command.snapshot_receipt_hash !==
          queryEvidence.semantic_binding.schema_snapshot_ref.resource_hash ||
        command.columns.length === 0 ||
        canonicalizeJson(command.columns) !==
          canonicalizeJson(
            queryEvidence.semantic_binding.columns.map((column) => ({
              name: column.output_name,
              arrow_type:
                column.logical_type === "NUMBER"
                  ? "FLOAT64"
                  : column.logical_type === "BOOLEAN"
                    ? "BOOL"
                    : column.logical_type === "DATE"
                      ? "DATE32"
                      : column.logical_type === "DATETIME"
                        ? "TIMESTAMP_MS"
                        : "UTF8",
              nullable: column.nullable,
              semantic_role: column.semantic_role,
              semantic_object_id: column.semantic_object_id,
            })),
          )
      ) {
        throw new TypeError("ANALYSIS_INPUT_MATERIALIZATION_CORRELATION_INVALID");
      }
      const plaintextHash = byteHash(command.content);
      const artifactId = deterministicAnalysisUuid(
        `analysis-input\0${command.lease.run_id}\0${command.analysis_program_ref.artifact_id}\0${command.node_id}\0${command.query_evidence_ref.content_hash}\0${plaintextHash}`,
      );
      const inputRef = artifactReferenceFor("SensitiveExecutionArtifact").parse({
        artifact_id: artifactId,
        artifact_type: "SensitiveExecutionArtifact",
        ...command.lease.scope,
        run_id: command.lease.run_id,
        revision: 1,
        content_hash: plaintextHash,
      });
      const aad = inputAad(command, plaintextHash, queryEvidence);
      const ciphertext = encryptInput({
        plaintext: command.content,
        key: input.encryption_key,
        aad,
      });
      const ciphertextHash = byteHash(ciphertext);
      const committedAt = leaseStartedAt(command.lease);
      const sensitiveReceipt = await buildSensitiveExecutionArtifactReceipt({
        schema_version: "sensitive-execution-artifact@2.0.0",
        artifact_ref: inputRef,
        content_kind: "ANALYSIS_INPUT",
        plaintext_hash: plaintextHash,
        ciphertext_hash: ciphertextHash,
        storage_key_hash: await sha256ContentHash({
          hash_domain: "analysis-input-storage-key@1.0.0",
          artifact_id: artifactId,
          ciphertext_hash: ciphertextHash,
        }),
        encryption: { algorithm: "AES-256-GCM", key_id: input.encryption_key_id },
        lifecycle: {
          status: "ACTIVE",
          expires_at: new Date(committedAt.getTime() + PRIMARY_RETENTION_MS).toISOString(),
          legal_hold: false,
          ref_count: 1,
          tombstoned_at: null,
          backup_expires_at: new Date(committedAt.getTime() + BACKUP_RETENTION_MS).toISOString(),
        },
        committed_at: committedAt.toISOString(),
      });
      const committedInput = await input.sensitive_artifacts.commit(input.capability_input, {
        command: {
          schema_version: "sensitive-execution-artifact-commit@2.0.0",
          receipt: sensitiveReceipt,
          idempotency_key: `analysis-input:${artifactId}`,
        },
        lease: command.lease,
        ciphertext,
      });
      if (
        !committedInput.ok ||
        committedInput.value.receipt.receipt_hash !== sensitiveReceipt.receipt_hash
      ) {
        throw new TypeError(
          committedInput.ok
            ? "ANALYSIS_INPUT_AUTHORITY_RECEIPT_MISMATCH"
            : committedInput.error.code,
        );
      }

      const materializationReceipt = await buildAnalysisInputMaterializationReceipt({
        artifact_type: "AnalysisInputMaterializationReceipt",
        protocol_version: "analysis-input-materialization@3.0.0",
        query_evidence_ref: command.query_evidence_ref,
        input_ref: inputRef,
        source_result_hash: queryEvidence.result_hash,
        source_binding_hash: queryEvidence.semantic_binding.binding_hash,
        input_hash: plaintextHash,
        input_format: "ARROW",
        input_byte_count: command.content.byteLength,
        row_count: command.row_count,
        columns: [...command.columns],
        spec_hash: command.spec_hash,
        snapshot_receipt_hash: command.snapshot_receipt_hash,
        materializer_version: MATERIALIZER_VERSION,
      });
      const receiptHash = await sha256ContentHash(materializationReceipt);
      const materializationRef = artifactReferenceFor("AnalysisInputMaterializationReceipt").parse({
        artifact_id: deterministicAnalysisUuid(
          `analysis-input-receipt\0${artifactId}\0${materializationReceipt.receipt_hash}`,
        ),
        artifact_type: "AnalysisInputMaterializationReceipt",
        ...command.lease.scope,
        run_id: command.lease.run_id,
        revision: 1,
        content_hash: receiptHash,
      });
      const committedReceipt = await input.analysis_artifacts.commitSystem({
        lease: command.lease,
        principal_id: command.lease.principal_id,
        idempotency_key: `analysis-input-receipt:${artifactId}`,
        reference: materializationRef,
        payload: materializationReceipt,
        content: null,
      });
      if (!exactReference(committedReceipt, materializationRef)) {
        throw new TypeError("ANALYSIS_INPUT_MATERIALIZATION_RECEIPT_COMMIT_MISMATCH");
      }
      return Object.freeze({
        name: command.input_name,
        format: command.format,
        query_evidence_ref: command.query_evidence_ref,
        query_evidence_document: resolved.value,
        input_ref: inputRef,
        materialization_receipt_ref: materializationRef,
        materialization_receipt_document: materializationReceipt,
        content: command.content,
      });
    },
  });
}

export const analysisInputMaterializerInternals = Object.freeze({
  byteHash,
  encryptInput,
  leaseStartedAt,
});
