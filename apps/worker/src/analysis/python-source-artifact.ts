import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import {
  type AnalysisContextModelCellSourceReadCommand,
  type AnalysisContextModelCellSourceReadResult,
  type AnalysisPythonSourceCommitCommand,
  type AnalysisPythonSourceCommitResult,
  artifactReferenceFor,
  buildAnalysisPythonSourceReceipt,
  verifyAnalysisPythonSourceReceipt,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { deterministicAnalysisUuid } from "./deterministic-id.js";
import type { AnalysisCellSourceArtifactPort } from "./executor.js";

const SOURCE_KEY_ENV = "DATA_AGENT_ANALYSIS_PYTHON_SOURCE_KEY_BASE64" as const;
const SOURCE_KEY_ID_ENV = "DATA_AGENT_ANALYSIS_PYTHON_SOURCE_KEY_ID" as const;
const DEFAULT_SOURCE_KEY_ID = "analysis-python-source-v1" as const;

export interface AnalysisPythonSourceAuthorityPort {
  commitAnalysisPythonSource(
    capabilityInput: unknown,
    command: AnalysisPythonSourceCommitCommand,
    ciphertext: Uint8Array,
  ): Promise<AnalysisPythonSourceCommitResult>;
  readAnalysisContextModelCellSource(
    capabilityInput: unknown,
    command: AnalysisContextModelCellSourceReadCommand,
  ): Promise<AnalysisContextModelCellSourceReadResult>;
}

function byteHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sourceHash(sourceText: string): `sha256:${string}` {
  return byteHash(Buffer.from(sourceText, "utf8"));
}

function sourceAad(input: {
  readonly lease: RunWorkLease;
  readonly analysis_program_ref: Parameters<
    AnalysisCellSourceArtifactPort["commit"]
  >[0]["analysis_program_ref"];
  readonly node_id: string;
  readonly generation_attempt: number;
  readonly source_sha256: `sha256:${string}`;
}) {
  return Buffer.from(
    canonicalizeJson({
      protocol_version: "analysis-python-source-aad@1.0.0",
      scope: input.lease.scope,
      run_id: input.lease.run_id,
      analysis_program_ref: input.analysis_program_ref,
      node_id: input.node_id,
      generation_attempt: input.generation_attempt,
      source_sha256: input.source_sha256,
    }),
    "utf8",
  );
}

function deterministicIv(key: Uint8Array, aad: Uint8Array): Uint8Array {
  return createHmac("sha256", key)
    .update("analysis-python-source-iv@1.0.0\0", "utf8")
    .update(aad)
    .digest()
    .subarray(0, 12);
}

function encryptSource(input: {
  readonly plaintext: string;
  readonly key: Uint8Array;
  readonly iv: Uint8Array;
  readonly aad: Uint8Array;
}) {
  if (input.key.byteLength !== 32 || input.iv.byteLength !== 12) {
    throw new TypeError("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_INVALID");
  }
  const cipher = createCipheriv("aes-256-gcm", input.key, input.iv);
  cipher.setAAD(input.aad);
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext,
    auth_tag: cipher.getAuthTag(),
  } as const;
}

function decryptSource(input: {
  readonly ciphertext: Uint8Array;
  readonly key: Uint8Array;
  readonly iv: Uint8Array;
  readonly auth_tag: Uint8Array;
  readonly aad: Uint8Array;
}): string {
  if (
    input.key.byteLength !== 32 ||
    input.iv.byteLength !== 12 ||
    input.auth_tag.byteLength !== 16
  ) {
    throw new TypeError("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_INVALID");
  }
  const decipher = createDecipheriv("aes-256-gcm", input.key, input.iv);
  decipher.setAAD(input.aad);
  decipher.setAuthTag(input.auth_tag);
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString("utf8");
}

export function resolveAnalysisPythonSourceEncryption(
  environment: NodeJS.ProcessEnv,
): { readonly key: Uint8Array; readonly key_id: string } | null {
  const encoded = environment[SOURCE_KEY_ENV]?.trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    throw new TypeError("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_INVALID");
  }
  return {
    key,
    key_id: environment[SOURCE_KEY_ID_ENV]?.trim() || DEFAULT_SOURCE_KEY_ID,
  };
}

export function createAnalysisPythonSourceArtifactPort(input: {
  readonly authority: AnalysisPythonSourceAuthorityPort;
  readonly commit_capability_input: unknown;
  readonly replay_capability_input: unknown;
  readonly encryption_key: Uint8Array;
  readonly encryption_key_id: string;
  readonly now?: () => Date;
}): AnalysisCellSourceArtifactPort {
  if (input.encryption_key.byteLength !== 32) {
    throw new TypeError("ANALYSIS_PYTHON_SOURCE_ENCRYPTION_CONFIG_INVALID");
  }
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async commit(command: Parameters<AnalysisCellSourceArtifactPort["commit"]>[0]) {
      if (
        command.analysis_program_ref.run_id !== command.lease.run_id ||
        command.analysis_program_ref.app_id !== command.lease.scope.app_id ||
        command.analysis_program_ref.tenant_id !== command.lease.scope.tenant_id ||
        command.analysis_program_ref.environment !== command.lease.scope.environment ||
        !command.analysis_program.nodes.some(({ node_id: nodeId }) => nodeId === command.node_id) ||
        sourceHash(command.source_text) !== command.source_sha256
      ) {
        throw new TypeError("ANALYSIS_PYTHON_SOURCE_COMMIT_CORRELATION_INVALID");
      }
      const artifactId = deterministicAnalysisUuid(
        `analysis-python-source\0${command.lease.run_id}\0${command.analysis_program_ref.artifact_id}\0${command.node_id}\0${command.generation_attempt}\0${command.source_sha256}`,
      );
      const artifactRef = artifactReferenceFor("SensitiveExecutionArtifact").parse({
        artifact_id: artifactId,
        artifact_type: "SensitiveExecutionArtifact",
        ...command.lease.scope,
        run_id: command.lease.run_id,
        revision: 1,
        content_hash: command.source_sha256,
      });
      const aad = sourceAad(command);
      const iv = deterministicIv(input.encryption_key, aad);
      const encrypted = encryptSource({
        plaintext: command.source_text,
        key: input.encryption_key,
        iv,
        aad,
      });
      const receipt = await buildAnalysisPythonSourceReceipt({
        schema_version: "analysis-python-source-receipt@1.0.0",
        artifact_ref: artifactRef,
        analysis_program_ref: command.analysis_program_ref,
        node_id: command.node_id,
        generation_attempt: command.generation_attempt,
        source_kind: "DEEPSEEK_GENERATED",
        provider_invocation_ref: command.provider_invocation_ref,
        plaintext_hash: command.source_sha256,
        ciphertext_hash: byteHash(encrypted.ciphertext),
        encryption: {
          algorithm: "AES-256-GCM",
          key_id: input.encryption_key_id,
          iv_base64: Buffer.from(iv).toString("base64"),
          auth_tag_base64: encrypted.auth_tag.toString("base64"),
        },
        storage: "POSTGRES_ENCRYPTED_BYTEA",
        committed_at: now().toISOString(),
      });
      const result = await input.authority.commitAnalysisPythonSource(
        input.commit_capability_input,
        {
          schema_version: "analysis-python-source-commit@1.0.0",
          scope: command.lease.scope,
          run_id: command.lease.run_id,
          principal_id: command.lease.principal_id,
          attempt_id: command.lease.attempt_id,
          worker_fence: command.lease.worker_fence,
          idempotency_key: `analysis-python-source:${command.analysis_program.program_hash}:${command.node_id}:${command.generation_attempt}`,
          receipt,
        },
        encrypted.ciphertext,
      );
      if (!result.ok) throw new TypeError(result.error_code);
      const committed = await verifyAnalysisPythonSourceReceipt(result.receipt);
      if (
        committed.receipt_hash !== receipt.receipt_hash ||
        committed.artifact_ref.artifact_id !== artifactRef.artifact_id ||
        committed.artifact_ref.content_hash !== command.source_sha256
      ) {
        throw new TypeError("ANALYSIS_PYTHON_SOURCE_AUTHORITY_SUBSTITUTION");
      }
      return committed.artifact_ref;
    },
    async load(command: Parameters<AnalysisCellSourceArtifactPort["load"]>[0]) {
      const result = await input.authority.readAnalysisContextModelCellSource(
        input.replay_capability_input,
        {
          schema_version: "analysis-context-model-cell-source-read@1.0.0",
          scope: command.lease.scope,
          run_id: command.lease.run_id,
          principal_id: command.lease.principal_id,
          attempt_id: command.lease.attempt_id,
          worker_fence: command.lease.worker_fence,
          node_id: command.node_id,
          context_generation: command.context_generation,
          journal_seq: command.journal_seq,
          source_ref: artifactReferenceFor("SensitiveExecutionArtifact").parse(command.source_ref),
        },
      );
      if (!result.ok) throw new TypeError(result.error_code);
      const receipt = await verifyAnalysisPythonSourceReceipt(result.receipt);
      if (
        receipt.artifact_ref.artifact_id !== command.source_ref.artifact_id ||
        receipt.artifact_ref.content_hash !== command.source_ref.content_hash ||
        receipt.node_id !== command.node_id
      ) {
        throw new TypeError("ANALYSIS_CONTEXT_MODEL_CELL_SOURCE_SUBSTITUTION");
      }
      const ciphertext = Buffer.from(result.ciphertext_base64, "base64");
      if (byteHash(ciphertext) !== receipt.ciphertext_hash) {
        throw new TypeError("ANALYSIS_PYTHON_SOURCE_CIPHERTEXT_MISMATCH");
      }
      const aad = sourceAad({
        lease: command.lease,
        analysis_program_ref: receipt.analysis_program_ref,
        node_id: receipt.node_id,
        generation_attempt: receipt.generation_attempt,
        source_sha256: receipt.plaintext_hash as `sha256:${string}`,
      });
      const source = decryptSource({
        ciphertext,
        key: input.encryption_key,
        iv: Buffer.from(receipt.encryption.iv_base64, "base64"),
        auth_tag: Buffer.from(receipt.encryption.auth_tag_base64, "base64"),
        aad,
      });
      if (sourceHash(source) !== receipt.plaintext_hash) {
        throw new TypeError("ANALYSIS_PYTHON_SOURCE_PLAINTEXT_MISMATCH");
      }
      return Object.freeze({
        source,
        source_sha256: receipt.plaintext_hash as `sha256:${string}`,
      });
    },
  });
}

export const analysisPythonSourceArtifactInternals = Object.freeze({
  byteHash,
  decryptSource,
  deterministicIv,
  encryptSource,
  sourceAad,
  sourceHash,
  source_key_env: SOURCE_KEY_ENV,
  source_key_id_env: SOURCE_KEY_ID_ENV,
});
