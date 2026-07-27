import { z } from "zod";
import { artifactReferenceIdentity } from "../envelope.js";
import { versionFrontierSchema } from "./planning.js";
import {
  addUniqueIssues,
  contentHashSchema,
  immutableIdSchema,
  nonNegativeIntSchema,
  U6_WIRE_LIMITS,
  uniqueReasonCodeArraySchema,
  versionIdentifierSchema,
} from "./primitives.js";
import {
  analysisReportRefSchema,
  atomicClaimRefSchema,
  coverageStateRefSchema,
  evidenceCheckReceiptRefSchema,
  evidenceGateReceiptRefSchema,
  evidencePlanRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  obligationExecutionDecisionRefSchema,
  policyReceiptRefSchema,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  readinessRevocationReceiptRefSchema,
  reportManifestRefSchema,
  reportProjectionReceiptRefSchema,
  reportReadyCertificateRefSchema,
  researchBriefRefSchema,
  researchStopDecisionRefSchema,
  sandboxExecutionReceiptRefSchema,
  schemaSnapshotRefSchema,
  semanticReleaseRefSchema,
  supportDecisionRefSchema,
} from "./references.js";

const uniqueArtifactReferences = <T extends z.ZodType>(schema: T, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(
        values,
        (value) => artifactReferenceIdentity(value as never),
        ctx,
        [],
        "Artifact Reference 必须唯一。",
      );
    });

export const evidenceGateInputRefSchema = z.union([
  researchBriefRefSchema,
  evidencePlanRefSchema,
  queryContractRefSchema,
  obligationExecutionDecisionRefSchema,
  queryEvidenceRefSchema,
  atomicClaimRefSchema,
  evidenceRelationRefSchema,
  evidenceCheckReceiptRefSchema,
  supportDecisionRefSchema,
  hypothesisAssessmentRefSchema,
  coverageStateRefSchema,
  researchStopDecisionRefSchema,
  reportManifestRefSchema,
  analysisReportRefSchema,
  reportProjectionReceiptRefSchema,
  semanticReleaseRefSchema,
  schemaSnapshotRefSchema,
  policyReceiptRefSchema,
  sandboxExecutionReceiptRefSchema,
]);

export const evidenceGateReceiptPayloadSchema = z.strictObject({
  artifact_type: z.literal("EvidenceGateReceipt"),
  protocol_version: z.literal("evidence-gate@1.0.0"),
  gate: z.enum(["SUPPORT", "CONFLICT", "FRESHNESS", "SOURCE_INDEPENDENCE"]),
  verdict: z.enum(["PASS", "FAIL"]),
  reason_codes: uniqueReasonCodeArraySchema(),
  evaluated_refs: uniqueArtifactReferences(
    evidenceGateInputRefSchema,
    1,
    U6_WIRE_LIMITS.max_artifact_input_refs,
  ),
  evaluator_version: versionIdentifierSchema,
  gate_input_hash: contentHashSchema,
});

const gateReceiptRefsSchema = z
  .strictObject({
    support: evidenceGateReceiptRefSchema,
    conflict: evidenceGateReceiptRefSchema,
    freshness: evidenceGateReceiptRefSchema,
    source_independence: evidenceGateReceiptRefSchema,
  })
  .superRefine((refs, ctx) => {
    addUniqueIssues(
      Object.values(refs),
      artifactReferenceIdentity,
      ctx,
      [],
      "四道 Evidence Gate 必须使用四张不同的 Receipt。",
    );
  });

export const reportReadyCertificateV2PayloadSchema = z.strictObject({
  artifact_type: z.literal("ReportReadyCertificate"),
  protocol_version: z.literal("report-ready@2.0.0"),
  stop_decision_ref: researchStopDecisionRefSchema,
  report_manifest_ref: reportManifestRefSchema,
  analysis_report_ref: analysisReportRefSchema,
  projection_receipt_ref: reportProjectionReceiptRefSchema,
  gate_receipt_refs: gateReceiptRefsSchema,
  material_support_decision_refs: uniqueArtifactReferences(
    supportDecisionRefSchema,
    1,
    U6_WIRE_LIMITS.max_obligations,
  ),
  version_frontier: versionFrontierSchema,
  input_closure_hash: contentHashSchema,
  certificate_semantic_hash: contentHashSchema,
  evaluated_through_input_event_seq: nonNegativeIntSchema,
});

export const READINESS_REVOCATION_REASONS = [
  "SEMANTIC_REVISION_CHANGED",
  "SCHEMA_REVISION_CHANGED",
  "DATA_SNAPSHOT_STALE",
  "POLICY_CHANGED",
  "IDENTITY_AUTHORITY_CHANGED",
  "EVIDENCE_REVOKED",
  "CERTIFICATE_TAMPERED",
] as const;
export const readinessRevocationReasonSchema = z.enum(READINESS_REVOCATION_REASONS);

export const readinessRevocationReceiptPayloadSchema = z.strictObject({
  artifact_type: z.literal("ReadinessRevocationReceipt"),
  protocol_version: z.literal("readiness-revocation@1.0.0"),
  certificate_ref: reportReadyCertificateRefSchema,
  observed_frontier: versionFrontierSchema,
  reason: readinessRevocationReasonSchema,
  trigger: z.enum(["FRONTIER_ADVANCE", "SERVICE_REQUEST"]),
  source_operation_id: immutableIdSchema,
  observed_frontier_event_seq: nonNegativeIntSchema,
  revocation_semantic_hash: contentHashSchema,
});

// Exported only as an exact target schema for closure walkers and tests.
export const readinessRevocationReceiptReferenceSchema = readinessRevocationReceiptRefSchema;

export type EvidenceGateReceiptPayload = z.infer<typeof evidenceGateReceiptPayloadSchema>;
export type ReportReadyCertificateV2Payload = z.infer<typeof reportReadyCertificateV2PayloadSchema>;
export type ReadinessRevocationReason = z.infer<typeof readinessRevocationReasonSchema>;
export type ReadinessRevocationReceiptPayload = z.infer<
  typeof readinessRevocationReceiptPayloadSchema
>;
