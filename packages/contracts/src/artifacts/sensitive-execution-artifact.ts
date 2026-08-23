import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { artifactReferenceFor } from "./envelope.js";

export const SENSITIVE_EXECUTION_ARTIFACT_CONTENT_KINDS = [
  "TOOL_RESULT",
  "CONTEXT_SLICE",
  "MODEL_VIEW",
  "COMPACTION_SUMMARY",
  "OMISSION_LEDGER",
  "OBLIGATION_LEDGER",
  "HANDOFF",
  "RECOVERY",
  "PYTHON_SOURCE",
] as const;

const canonicalUtcTimestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const encryptionSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  key_id: versionIdentifierSchema,
});

const lifecycleSchema = z
  .strictObject({
    status: z.enum(["ACTIVE", "TOMBSTONED"]),
    expires_at: canonicalUtcTimestampSchema,
    legal_hold: z.boolean(),
    ref_count: z.number().int().nonnegative(),
    tombstoned_at: canonicalUtcTimestampSchema.nullable(),
    backup_expires_at: canonicalUtcTimestampSchema,
  })
  .superRefine((lifecycle, ctx) => {
    if (lifecycle.status === "ACTIVE") {
      if (lifecycle.ref_count < 1) {
        ctx.addIssue({
          code: "custom",
          message: "Active sensitive artifact must retain at least one reference.",
          path: ["ref_count"],
        });
      }
      if (lifecycle.tombstoned_at !== null) {
        ctx.addIssue({
          code: "custom",
          message: "Active sensitive artifact cannot have a tombstone time.",
          path: ["tombstoned_at"],
        });
      }
    } else {
      if (lifecycle.ref_count !== 0 || lifecycle.tombstoned_at === null || lifecycle.legal_hold) {
        ctx.addIssue({
          code: "custom",
          message:
            "Tombstoned sensitive artifact requires zero refs, a tombstone time and no legal hold.",
          path: ["status"],
        });
      }
    }
    if (Date.parse(lifecycle.backup_expires_at) < Date.parse(lifecycle.expires_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Backup expiry cannot precede primary expiry.",
        path: ["backup_expires_at"],
      });
    }
  });

const sensitiveExecutionArtifactReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("sensitive-execution-artifact@1.0.0"),
  artifact_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
  task_id: immutableIdSchema,
  context_epoch_id: immutableIdSchema.nullable(),
  content_kind: z.enum(SENSITIVE_EXECUTION_ARTIFACT_CONTENT_KINDS),
  plaintext_hash: contentHashSchema,
  ciphertext_hash: contentHashSchema,
  storage_key_hash: contentHashSchema,
  encryption: encryptionSchema,
  lifecycle: lifecycleSchema,
  committed_at: canonicalUtcTimestampSchema,
});

export const sensitiveExecutionArtifactReceiptSchema = sensitiveExecutionArtifactReceiptDraftSchema
  .extend({ receipt_hash: contentHashSchema })
  .superRefine((receipt, ctx) => {
    if (receipt.artifact_ref.content_hash !== receipt.plaintext_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Artifact ref content hash must equal the plaintext content hash.",
        path: ["artifact_ref", "content_hash"],
      });
    }
  });

export type SensitiveExecutionArtifactReceipt = z.infer<
  typeof sensitiveExecutionArtifactReceiptSchema
>;

export async function computeSensitiveExecutionArtifactReceiptHash(input: unknown) {
  return sha256ContentHash(sensitiveExecutionArtifactReceiptDraftSchema.parse(input));
}

export async function buildSensitiveExecutionArtifactReceipt(
  input: unknown,
): Promise<SensitiveExecutionArtifactReceipt> {
  const draft = sensitiveExecutionArtifactReceiptDraftSchema.parse(input);
  return deepFreeze(
    sensitiveExecutionArtifactReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeSensitiveExecutionArtifactReceiptHash(draft),
    }),
  );
}

export async function verifySensitiveExecutionArtifactReceipt(
  input: unknown,
): Promise<SensitiveExecutionArtifactReceipt> {
  const receipt = sensitiveExecutionArtifactReceiptSchema.parse(input);
  const { receipt_hash: actual, ...draft } = receipt;
  if ((await computeSensitiveExecutionArtifactReceiptHash(draft)) !== actual) {
    throw new Error("SENSITIVE_EXECUTION_ARTIFACT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const commitSensitiveExecutionArtifactCommandSchema = z.strictObject({
  schema_version: z.literal("sensitive-execution-artifact-commit@1.0.0"),
  receipt: sensitiveExecutionArtifactReceiptSchema,
  idempotency_key: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/),
});
export type CommitSensitiveExecutionArtifactCommand = z.infer<
  typeof commitSensitiveExecutionArtifactCommandSchema
>;

export const commitSensitiveExecutionArtifactResultSchema = z.strictObject({
  schema_version: z.literal("sensitive-execution-artifact-commit-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  receipt: sensitiveExecutionArtifactReceiptSchema,
});
export type CommitSensitiveExecutionArtifactResult = z.infer<
  typeof commitSensitiveExecutionArtifactResultSchema
>;

export const loadSensitiveExecutionArtifactCommandSchema = z.strictObject({
  schema_version: z.literal("sensitive-execution-artifact-load@1.0.0"),
  artifact_ref: artifactReferenceFor("SensitiveExecutionArtifact"),
  task_id: immutableIdSchema,
  context_epoch_id: immutableIdSchema.nullable(),
  ciphertext_hash: contentHashSchema,
  capability_id: immutableIdSchema,
  capability_hash: contentHashSchema,
});
export type LoadSensitiveExecutionArtifactCommand = z.infer<
  typeof loadSensitiveExecutionArtifactCommandSchema
>;

export const loadSensitiveExecutionArtifactResultSchema = z.strictObject({
  schema_version: z.literal("sensitive-execution-artifact-load-result@1.0.0"),
  receipt: sensitiveExecutionArtifactReceiptSchema.nullable(),
});
