import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { artifactReferenceFor } from "./envelope.js";

const providerInvocationRefSchema = z.strictObject({
  resource_id: immutableIdSchema,
  resource_revision: z.literal(1),
  resource_hash: contentHashSchema,
});

const encryptionSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  key_id: versionIdentifierSchema,
  iv_base64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u).max(64),
  auth_tag_base64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u).max(64),
});

const analysisPythonSourceReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("analysis-python-source-receipt@1.0.0"),
    artifact_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
    analysis_program_ref: artifactReferenceFor("AnalysisProgram"),
    node_id: versionIdentifierSchema,
    generation_attempt: z.union([z.literal(0), z.literal(1)]),
    source_kind: z.enum(["STANDARD_PROGRAM", "DEEPSEEK_GENERATED"]),
    provider_invocation_ref: providerInvocationRefSchema.nullable(),
    plaintext_hash: contentHashSchema,
    ciphertext_hash: contentHashSchema,
    encryption: encryptionSchema,
    storage: z.literal("POSTGRES_ENCRYPTED_BYTEA"),
    committed_at: timestampSchema,
  })
  .superRefine((receipt, context) => {
    const artifact = receipt.artifact_ref;
    const program = receipt.analysis_program_ref;
    if (
      artifact.app_id !== program.app_id ||
      artifact.tenant_id !== program.tenant_id ||
      artifact.environment !== program.environment ||
      artifact.run_id !== program.run_id
    ) {
      context.addIssue({
        code: "custom",
        message: "Python source and AnalysisProgram must share the exact scope and run.",
        path: ["analysis_program_ref"],
      });
    }
    if (artifact.content_hash !== receipt.plaintext_hash) {
      context.addIssue({
        code: "custom",
        message: "Python source reference must bind the plaintext hash.",
        path: ["plaintext_hash"],
      });
    }
    if (
      (receipt.source_kind === "DEEPSEEK_GENERATED") !==
      (receipt.provider_invocation_ref !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only DeepSeek-generated source binds a provider invocation.",
        path: ["provider_invocation_ref"],
      });
    }
    if (receipt.source_kind === "STANDARD_PROGRAM" && receipt.generation_attempt !== 0) {
      context.addIssue({
        code: "custom",
        message: "Standard programs cannot be generated as a repair attempt.",
        path: ["generation_attempt"],
      });
    }
  });

export const analysisPythonSourceReceiptSchema = analysisPythonSourceReceiptDraftSchema.extend({
  receipt_hash: contentHashSchema,
});

export type AnalysisPythonSourceReceipt = z.infer<typeof analysisPythonSourceReceiptSchema>;

export async function buildAnalysisPythonSourceReceipt(
  input: unknown,
): Promise<AnalysisPythonSourceReceipt> {
  const draft = analysisPythonSourceReceiptDraftSchema.parse(input);
  return deepFreeze(
    analysisPythonSourceReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash({
        hash_domain: "analysis-python-source-receipt@1.0.0",
        value: draft,
      }),
    }),
  );
}

export async function verifyAnalysisPythonSourceReceipt(
  input: unknown,
): Promise<AnalysisPythonSourceReceipt> {
  const receipt = analysisPythonSourceReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...draft } = receipt;
  const expectedHash = await sha256ContentHash({
    hash_domain: "analysis-python-source-receipt@1.0.0",
    value: draft,
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("ANALYSIS_PYTHON_SOURCE_RECEIPT_HASH_INVALID");
  }
  return deepFreeze(receipt);
}

export const analysisPythonSourceCommitCommandSchema = z
  .strictObject({
    schema_version: z.literal("analysis-python-source-commit@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().positive(),
    idempotency_key: z.string().min(8).max(256),
    receipt: analysisPythonSourceReceiptSchema,
  })
  .superRefine((command, context) => {
    const reference = command.receipt.artifact_ref;
    if (
      command.scope.app_id !== reference.app_id ||
      command.scope.tenant_id !== reference.tenant_id ||
      command.scope.environment !== reference.environment ||
      command.run_id !== reference.run_id
    ) {
      context.addIssue({
        code: "custom",
        message: "Python source command must bind the receipt scope and run.",
        path: ["receipt"],
      });
    }
  });

export type AnalysisPythonSourceCommitCommand = z.infer<
  typeof analysisPythonSourceCommitCommandSchema
>;

export const analysisPythonSourceCommitResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    created: z.boolean(),
    receipt: analysisPythonSourceReceiptSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error_code: z.enum([
      "ANALYSIS_PYTHON_SOURCE_CONTRACT_INVALID",
      "ANALYSIS_PYTHON_SOURCE_SCOPE_MISMATCH",
      "ANALYSIS_PYTHON_SOURCE_CIPHERTEXT_MISMATCH",
      "ANALYSIS_PYTHON_SOURCE_IDEMPOTENCY_CONFLICT",
      "RESEARCH_AUTHORITY_FENCE_MISMATCH",
      "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
      "RESEARCH_DATABASE_AUTHORITY_REQUIRED",
      "RESEARCH_DATABASE_CONTRACT_INVALID",
      "RESEARCH_PERSISTENCE_UNAVAILABLE",
      "RESEARCH_AUTHORITY_LOCK_CONTENDED",
    ]),
  }),
]);

export type AnalysisPythonSourceCommitResult = z.infer<
  typeof analysisPythonSourceCommitResultSchema
>;

export const analysisPythonSourceLoadCommandSchema = z
  .strictObject({
    schema_version: z.literal("analysis-python-source-load@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().positive(),
    analysis_program_ref: artifactReferenceFor("AnalysisProgram"),
    node_id: versionIdentifierSchema,
    generation_attempt: z.union([z.literal(0), z.literal(1)]),
  })
  .superRefine((command, context) => {
    const program = command.analysis_program_ref;
    if (
      command.scope.app_id !== program.app_id ||
      command.scope.tenant_id !== program.tenant_id ||
      command.scope.environment !== program.environment ||
      command.run_id !== program.run_id
    ) {
      context.addIssue({
        code: "custom",
        message: "Python source load must bind the AnalysisProgram scope and run.",
        path: ["analysis_program_ref"],
      });
    }
  });

export type AnalysisPythonSourceLoadCommand = z.infer<
  typeof analysisPythonSourceLoadCommandSchema
>;

export const analysisPythonSourceLoadResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    source: z
      .strictObject({
        receipt: analysisPythonSourceReceiptSchema,
        ciphertext_base64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u).max(180_000),
      })
      .nullable(),
  }),
  z.strictObject({
    ok: z.literal(false),
    error_code: z.enum([
      "ANALYSIS_PYTHON_SOURCE_CONTRACT_INVALID",
      "ANALYSIS_PYTHON_SOURCE_SCOPE_MISMATCH",
      "RESEARCH_AUTHORITY_FENCE_MISMATCH",
      "RESEARCH_CAPABILITY_SCOPE_MISMATCH",
      "RESEARCH_DATABASE_AUTHORITY_REQUIRED",
      "RESEARCH_DATABASE_CONTRACT_INVALID",
      "RESEARCH_PERSISTENCE_UNAVAILABLE",
      "RESEARCH_AUTHORITY_LOCK_CONTENDED",
    ]),
  }),
]);

export type AnalysisPythonSourceLoadResult = z.infer<
  typeof analysisPythonSourceLoadResultSchema
>;
