import { z } from "zod";
import { artifactReferenceIdentity, artifactReferenceSchema } from "../artifacts/envelope.js";
import { semanticSuccessorCandidateReleaseReferenceSchema } from "../artifacts/semantic-lifecycle.js";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import { FALCON24_REQUIRED_UI_ARTIFACT_TYPES } from "./falcon24-acceptance-campaign.js";

export const FALCON24_E4_DIAGNOSTIC_QUESTION =
  "最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。" as const;

export const FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH = Object.freeze([
  "SEMANTIC",
  "TEXT2SQL",
  "SQL",
  "QUERY_EVIDENCE",
  "TYPED_ARROW",
  "PYTHON_OPERATOR",
  "ANALYSIS_REPORT",
  "CHART",
] as const);

const e4AuthorityBindingSchema = z.strictObject({
  schema_version: z.literal("falcon24-authority-binding@2.0.0"),
  authority_epoch: z.literal("E4"),
  baseline_id: immutableIdSchema,
  baseline_hash: contentHashSchema,
  activation_attempt_id: immutableIdSchema,
});

const buildIdentitySchema = z.strictObject({
  build_id: contentHashSchema,
  generation_id: contentHashSchema,
});

const diagnosticAttemptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-diagnostic-attempt@1.0.0"),
    attempt_id: immutableIdSchema,
    run_id: immutableIdSchema,
    authority: e4AuthorityBindingSchema,
    semantic_release: semanticSuccessorCandidateReleaseReferenceSchema,
    source_commit: z.string().regex(/^[0-9a-f]{40}$/u),
    source_fingerprint: contentHashSchema,
    web_build: buildIdentitySchema,
    worker_build: buildIdentitySchema,
    runtime_attestation_hash: contentHashSchema,
    question: z.literal(FALCON24_E4_DIAGNOSTIC_QUESTION),
    question_hash: contentHashSchema,
  })
  .superRefine((attempt, context) => {
    if (attempt.semantic_release.generation !== 2) {
      context.addIssue({
        code: "custom",
        message: "FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_INVALID",
        path: ["semantic_release"],
      });
    }
  });

export const falcon24DiagnosticAttemptSchema = diagnosticAttemptMaterialSchema.extend({
  manifest_hash: contentHashSchema,
});

export const falcon24DiagnosticReceiptReferenceSchema = z.strictObject({
  attempt_id: immutableIdSchema,
  run_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
});

const observedExecutionPathSchema = z
  .array(z.enum(FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH))
  .length(FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH.length)
  .superRefine((path, context) => {
    if (path.some((step, index) => step !== FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH[index])) {
      context.addIssue({
        code: "custom",
        message: "诊断回执必须证明动态 Tool Loop 实际观察到的完整执行闭包。",
      });
    }
  });

const diagnosticPassEvidenceSchema = z
  .strictObject({
    qa_e2e_receipt_hash: contentHashSchema,
    trace_ui_receipt_hash: contentHashSchema,
    trace_hash: contentHashSchema,
    opened_artifact_refs: z.array(artifactReferenceSchema).length(5),
    observed_execution_path: observedExecutionPathSchema,
    sandbox_reclamation_receipt_hash: contentHashSchema,
    residual: z.literal(0),
  })
  .superRefine((evidence, context) => {
    const identities = evidence.opened_artifact_refs.map(artifactReferenceIdentity);
    const types = evidence.opened_artifact_refs
      .map(({ artifact_type: artifactType }) => artifactType)
      .sort();
    if (
      new Set(identities).size !== identities.length ||
      types.some((type, index) => type !== FALCON24_REQUIRED_UI_ARTIFACT_TYPES[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID",
        path: ["opened_artifact_refs"],
      });
    }
  });

export const falcon24DiagnosticFailureClassSchema = z.enum([
  "FROZEN_CLOSURE_CHANGE_REQUIRED",
  "EXTERNAL_DEPENDENCY",
]);

const stableFailureCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/u);

const diagnosticReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-diagnostic-receipt@1.0.0"),
    attempt_id: immutableIdSchema,
    run_id: immutableIdSchema,
    attempt_manifest_hash: contentHashSchema,
    authority: e4AuthorityBindingSchema,
    semantic_release: semanticSuccessorCandidateReleaseReferenceSchema,
    outcome: z.enum(["PASS", "FAIL"]),
    pass_evidence: diagnosticPassEvidenceSchema.nullable(),
    failure_class: falcon24DiagnosticFailureClassSchema.nullable(),
    failure_code: stableFailureCodeSchema.nullable(),
    completed_at: timestampSchema,
  })
  .superRefine((receipt, context) => {
    const passed = receipt.outcome === "PASS";
    if (
      receipt.semantic_release.generation !== 2 ||
      passed !== (receipt.pass_evidence !== null) ||
      passed === (receipt.failure_class !== null) ||
      passed === (receipt.failure_code !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "FALCON24_DIAGNOSTIC_OUTCOME_INVALID",
      });
    }
    if (
      receipt.pass_evidence?.opened_artifact_refs.some(
        (reference) => reference.run_id !== receipt.run_id,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "FALCON24_DIAGNOSTIC_RUN_CLOSURE_INVALID",
        path: ["pass_evidence", "opened_artifact_refs"],
      });
    }
  });

export const falcon24DiagnosticReceiptSchema = diagnosticReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

export async function buildFalcon24DiagnosticAttempt(input: unknown) {
  const material = diagnosticAttemptMaterialSchema.parse(input);
  if ((await sha256ContentHash(material.question)) !== material.question_hash) {
    throw new TypeError("FALCON24_DIAGNOSTIC_QUESTION_HASH_INVALID");
  }
  return falcon24DiagnosticAttemptSchema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24DiagnosticAttempt(input: unknown) {
  const attempt = falcon24DiagnosticAttemptSchema.parse(input);
  const { manifest_hash: observedHash, ...material } = attempt;
  if (
    (await sha256ContentHash(material.question)) !== material.question_hash ||
    (await sha256ContentHash(material)) !== observedHash
  ) {
    throw new TypeError("FALCON24_DIAGNOSTIC_ATTEMPT_HASH_INVALID");
  }
  return attempt;
}

export async function buildFalcon24DiagnosticReceipt(input: unknown) {
  const material = diagnosticReceiptMaterialSchema.parse(input);
  return falcon24DiagnosticReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24DiagnosticReceipt(input: unknown) {
  const receipt = falcon24DiagnosticReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_DIAGNOSTIC_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export type Falcon24DiagnosticAttempt = z.infer<typeof falcon24DiagnosticAttemptSchema>;
export type Falcon24DiagnosticReceipt = z.infer<typeof falcon24DiagnosticReceiptSchema>;
