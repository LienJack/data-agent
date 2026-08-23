import { z } from "zod";
import { artifactReferenceIdentity } from "../envelope.js";
import { versionFrontierSchema } from "./planning.js";
import {
  addUniqueIssues,
  contentHashSchema,
  finiteNumberSchema,
  identifierSchema,
  nonEmptyTextSchema,
  nonNegativeIntSchema,
  U6_WIRE_LIMITS,
  uniqueReasonCodeArraySchema,
  uniqueStringArraySchema,
  versionIdentifierSchema,
} from "./primitives.js";
import {
  analysisCompletionReceiptRefSchema,
  analysisProgramRefSchema,
  atomicClaimRefSchema,
  causalEstimateRefSchema,
  derivedAnalysisEvidenceRefSchema,
  discoveryCandidateRefSchema,
  discoveryReceiptRefSchema,
  embeddedNodeReferenceIdentity,
  evidenceCheckReceiptRefSchema,
  evidenceRelationRefSchema,
  executionReceiptRefSchema,
  hypothesisRefSchema,
  metricRefSchema,
  obligationExecutionDecisionRefSchema,
  policyReceiptRefSchema,
  proofObligationRefSchema,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  researchBriefRefSchema,
  sandboxExecutionReceiptRefSchema,
  sandboxProgramRefSchema,
  sandboxResultRefSchema,
  schemaSnapshotRefSchema,
  semanticReleaseRefSchema,
  sqlArtifactRefSchema,
  supportDecisionRefSchema,
  validationReceiptRefSchema,
} from "./references.js";

const uniqueArtifactReferenceArray = <T extends z.ZodType>(schema: T, min: number, max: number) =>
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

const uniqueEmbeddedReferenceArray = <T extends z.ZodType>(schema: T, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(
        values,
        (value) => embeddedNodeReferenceIdentity(value as never),
        ctx,
        [],
        "Embedded Reference 必须唯一。",
      );
    });

export const OBLIGATION_SEMANTIC_CHECKS = [
  "metric",
  "metric_formula",
  "time_window",
  "timezone",
  "grain",
  "dimensions",
  "grouping",
  "joins",
  "canonical_predicates",
  "cohort",
  "null_semantics",
  "authorization_scope",
] as const;

const checkVerdictSchema = z.enum(["MATCH", "MISMATCH"]);
export const obligationSemanticChecksSchema = z.strictObject({
  metric: checkVerdictSchema,
  metric_formula: checkVerdictSchema,
  time_window: checkVerdictSchema,
  timezone: checkVerdictSchema,
  grain: checkVerdictSchema,
  dimensions: checkVerdictSchema,
  grouping: checkVerdictSchema,
  joins: checkVerdictSchema,
  canonical_predicates: checkVerdictSchema,
  cohort: checkVerdictSchema,
  null_semantics: checkVerdictSchema,
  authorization_scope: checkVerdictSchema,
});

export const obligationExecutionDecisionPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("ObligationExecutionDecision"),
    protocol_version: z.literal("obligation-execution@2.0.0"),
    brief_ref: researchBriefRefSchema,
    obligation_ref: proofObligationRefSchema,
    query_contract_ref: queryContractRefSchema,
    sql_artifact_ref: sqlArtifactRefSchema,
    semantic_release_ref: semanticReleaseRefSchema,
    policy_receipt_ref: policyReceiptRefSchema,
    observation_contract_hash: contentHashSchema,
    verdict: z.enum(["PASS", "FAIL"]),
    checks: obligationSemanticChecksSchema,
    reason_codes: uniqueReasonCodeArraySchema(),
    evaluator_version: versionIdentifierSchema,
    decision_semantic_hash: contentHashSchema,
  })
  .superRefine((decision, ctx) => {
    const mismatch = Object.values(decision.checks).some((check) => check === "MISMATCH");
    if (decision.verdict === "PASS" && (mismatch || decision.reason_codes.length !== 0)) {
      ctx.addIssue({
        code: "custom",
        message: "OED PASS 要求全部 MATCH 且 Reason Code 为空。",
        path: ["verdict"],
      });
    }
    if (
      mismatch &&
      (decision.verdict !== "FAIL" ||
        !decision.reason_codes.includes("OBLIGATION_QUERY_SEMANTICS_MISMATCH"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "OED MISMATCH 必须返回 FAIL/OBLIGATION_QUERY_SEMANTICS_MISMATCH。",
        path: ["reason_codes"],
      });
    }
    if (
      !mismatch &&
      decision.verdict === "FAIL" &&
      decision.reason_codes.includes("OBLIGATION_QUERY_SEMANTICS_MISMATCH")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "全部 MATCH 时不能声明语义不匹配。",
        path: ["reason_codes"],
      });
    }
  });

export const queryEvidenceV2PayloadSchema = z.strictObject({
  artifact_type: z.literal("QueryEvidence"),
  protocol_version: z.literal("query-evidence@2.0.0"),
  obligation_ref: proofObligationRefSchema,
  obligation_execution_decision_ref: obligationExecutionDecisionRefSchema,
  query_contract_ref: queryContractRefSchema,
  sql_artifact_ref: sqlArtifactRefSchema,
  validation_receipt_ref: validationReceiptRefSchema,
  execution_receipt_ref: executionReceiptRefSchema,
  sandbox_execution_receipt_ref: sandboxExecutionReceiptRefSchema,
  sandbox_result_ref: sandboxResultRefSchema,
  dependency_evidence_refs: uniqueArtifactReferenceArray(
    queryEvidenceRefSchema,
    0,
    U6_WIRE_LIMITS.max_dependencies_per_obligation,
  ),
  provenance_group: identifierSchema,
  observed_version: versionFrontierSchema,
  observation: z.strictObject({
    result_hash: contentHashSchema,
    row_count: nonNegativeIntSchema,
    schema_hash: contentHashSchema,
  }),
});

export const claimScalarValueSchema = z.discriminatedUnion("value_kind", [
  z.strictObject({
    value_kind: z.literal("NUMBER"),
    number_value: finiteNumberSchema,
    text_value: z.null(),
    unit: identifierSchema,
  }),
  z.strictObject({
    value_kind: z.literal("TEXT"),
    number_value: z.null(),
    text_value: nonEmptyTextSchema,
    unit: z.null(),
  }),
]);

export const claimObservationBindingSchema = z.strictObject({
  binding_id: identifierSchema,
  evidence_ref: queryEvidenceRefSchema,
  metric_ref: metricRefSchema,
  output_alias: identifierSchema,
  row_key_hash: contentHashSchema,
  observed_value: claimScalarValueSchema,
  time_window_hash: contentHashSchema,
  dimension_slice_hash: contentHashSchema,
  result_cell_hash: contentHashSchema,
});

export const atomicClaimPredicateSchema = z.discriminatedUnion("claim_mode", [
  z.strictObject({
    claim_mode: z.literal("DESCRIPTIVE"),
    observation_binding_id: identifierSchema,
    operator: z.enum(["EQ", "GTE", "LTE"]),
    asserted_value: claimScalarValueSchema,
  }),
  z.strictObject({
    claim_mode: z.literal("COMPARATIVE"),
    left_binding_id: identifierSchema,
    right_binding_id: identifierSchema,
    operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
    absolute_delta: finiteNumberSchema,
    relative_delta: finiteNumberSchema.nullable(),
  }),
  z.strictObject({
    claim_mode: z.literal("DIAGNOSTIC"),
    outcome_change_binding_id: identifierSchema,
    contribution_binding_ids: z
      .array(identifierSchema)
      .min(1)
      .max(U6_WIRE_LIMITS.max_obligations)
      .superRefine((values, ctx) => {
        addUniqueIssues(values, (value) => value, ctx, [], "Contribution Binding ID 必须唯一。");
      }),
    operator: z.enum(["SUM_EQUALS", "SHARE_OF"]),
    asserted_value: finiteNumberSchema,
    tolerance: z.literal(0),
  }),
]);

function predicateBindingIds(predicate: z.infer<typeof atomicClaimPredicateSchema>): string[] {
  switch (predicate.claim_mode) {
    case "DESCRIPTIVE":
      return [predicate.observation_binding_id];
    case "COMPARATIVE":
      return [predicate.left_binding_id, predicate.right_binding_id];
    case "DIAGNOSTIC":
      return [predicate.outcome_change_binding_id, ...predicate.contribution_binding_ids];
  }
}

export const atomicClaimV2PayloadSchema = z
  .strictObject({
    artifact_type: z.literal("AtomicClaim"),
    protocol_version: z.literal("atomic-claim@2.0.0"),
    claim_id: identifierSchema,
    observation_bindings: z
      .array(claimObservationBindingSchema)
      .min(1)
      .max(U6_WIRE_LIMITS.max_obligations),
    predicate: atomicClaimPredicateSchema,
    claim_renderer_version: versionIdentifierSchema,
    statement: nonEmptyTextSchema,
    statement_hash: contentHashSchema,
    evidence_refs: uniqueArtifactReferenceArray(
      queryEvidenceRefSchema,
      1,
      U6_WIRE_LIMITS.max_obligations,
    ),
    limitations: uniqueStringArraySchema(0, U6_WIRE_LIMITS.max_obligations),
  })
  .superRefine((claim, ctx) => {
    addUniqueIssues(
      claim.observation_bindings,
      ({ binding_id }) => binding_id,
      ctx,
      ["observation_bindings"],
      "Observation Binding ID 必须唯一。",
    );
    const available = new Set(claim.observation_bindings.map(({ binding_id }) => binding_id));
    const used = predicateBindingIds(claim.predicate);
    if (
      used.some((bindingId) => !available.has(bindingId)) ||
      new Set(used).size !== used.length ||
      new Set(used).size !== available.size
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Predicate 必须精确使用全部且仅使用已声明的 Observation Binding。",
        path: ["predicate"],
      });
    }
    const expectedEvidence = [
      ...new Set(
        claim.observation_bindings.map(({ evidence_ref }) =>
          artifactReferenceIdentity(evidence_ref),
        ),
      ),
    ].sort();
    const actualEvidence = claim.evidence_refs.map(artifactReferenceIdentity).sort();
    if (JSON.stringify(expectedEvidence) !== JSON.stringify(actualEvidence)) {
      ctx.addIssue({
        code: "custom",
        message: "AtomicClaim evidence_refs 必须等于 Observation Binding 的 Evidence 集合。",
        path: ["evidence_refs"],
      });
    }
  });

export const evidenceRelationV2PayloadSchema = z.strictObject({
  artifact_type: z.literal("EvidenceRelation"),
  protocol_version: z.literal("evidence-relation@2.0.0"),
  claim_ref: atomicClaimRefSchema,
  evidence_ref: queryEvidenceRefSchema,
  proposed_relation: z.enum(["SUPPORTS", "REFUTES", "CONFLICTS", "QUALIFIES", "CONTEXT_ONLY"]),
  rationale: nonEmptyTextSchema,
  obligation_ref: proofObligationRefSchema,
});

export const evidenceCheckInputRefSchema = z.union([
  evidenceRelationRefSchema,
  atomicClaimRefSchema,
  queryEvidenceRefSchema,
  queryContractRefSchema,
  semanticReleaseRefSchema,
  schemaSnapshotRefSchema,
  policyReceiptRefSchema,
  sandboxExecutionReceiptRefSchema,
  sandboxResultRefSchema,
]);

export const evidenceCheckReceiptPayloadSchema = z.strictObject({
  artifact_type: z.literal("EvidenceCheckReceipt"),
  protocol_version: z.literal("evidence-check@1.0.0"),
  relation_ref: evidenceRelationRefSchema,
  check_kind: z.enum(["DETERMINISTIC_CHECK", "PROVENANCE_CHECK"]),
  verdict: z.enum(["PASS", "FAIL"]),
  observed_contract_hash: contentHashSchema,
  evaluated_refs: uniqueArtifactReferenceArray(evidenceCheckInputRefSchema, 1, 128),
  reason_codes: uniqueReasonCodeArraySchema(),
  evaluator_version: versionIdentifierSchema,
  check_input_hash: contentHashSchema,
});

export const evidenceCheckInputRefV2Schema = z.union([
  evidenceCheckInputRefSchema,
  analysisProgramRefSchema,
  analysisCompletionReceiptRefSchema,
  derivedAnalysisEvidenceRefSchema,
  sandboxProgramRefSchema,
  discoveryCandidateRefSchema,
  discoveryReceiptRefSchema,
  causalEstimateRefSchema,
]);

export const evidenceCheckReceiptV2PayloadSchema = z.strictObject({
  artifact_type: z.literal("EvidenceCheckReceipt"),
  protocol_version: z.literal("evidence-check@2.0.0"),
  relation_ref: evidenceRelationRefSchema,
  check_kind: z.enum([
    "DETERMINISTIC_CHECK",
    "PROVENANCE_CHECK",
    "PROGRAM_CLOSURE_CHECK",
    "CAUSAL_CERTIFICATE_CHECK",
  ]),
  verdict: z.enum(["PASS", "FAIL"]),
  observed_contract_hash: contentHashSchema,
  evaluated_refs: uniqueArtifactReferenceArray(evidenceCheckInputRefV2Schema, 1, 128),
  reason_codes: z.array(identifierSchema).max(U6_WIRE_LIMITS.max_reason_codes),
  evaluator_version: versionIdentifierSchema,
  check_input_hash: contentHashSchema,
});

export const supportDecisionPayloadSchema = z.strictObject({
  artifact_type: z.literal("SupportDecision"),
  protocol_version: z.literal("support-decision@1.0.0"),
  claim_ref: atomicClaimRefSchema,
  relation_refs: uniqueArtifactReferenceArray(
    evidenceRelationRefSchema,
    1,
    U6_WIRE_LIMITS.max_obligations,
  ),
  check_receipt_refs: uniqueArtifactReferenceArray(evidenceCheckReceiptRefSchema, 2, 64),
  obligation_refs: uniqueEmbeddedReferenceArray(
    proofObligationRefSchema,
    1,
    U6_WIRE_LIMITS.max_obligations,
  ),
  decision: z.enum(["SUPPORTED", "REFUTED", "CONFLICTED", "INSUFFICIENT", "UNSUPPORTED"]),
  reason_codes: uniqueReasonCodeArraySchema(),
  evaluator_version: versionIdentifierSchema,
  input_closure_hash: contentHashSchema,
});

export const hypothesisAssessmentPayloadSchema = z
  .strictObject({
    artifact_type: z.literal("HypothesisAssessment"),
    protocol_version: z.literal("hypothesis-assessment@1.0.0"),
    hypothesis_ref: hypothesisRefSchema,
    support_decision_refs: uniqueArtifactReferenceArray(supportDecisionRefSchema, 0, 128),
    status: z.enum(["TESTED", "REFUTED", "SURVIVED", "UNRESOLVED"]),
    unresolved_obligation_refs: uniqueEmbeddedReferenceArray(
      proofObligationRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    reason_codes: uniqueReasonCodeArraySchema(),
  })
  .superRefine((assessment, ctx) => {
    if (assessment.status !== "UNRESOLVED" && assessment.support_decision_refs.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `${assessment.status} HypothesisAssessment 必须包含 SupportDecision。`,
        path: ["support_decision_refs"],
      });
    }
  });

export type ObligationExecutionDecisionPayload = z.infer<
  typeof obligationExecutionDecisionPayloadSchema
>;
export type QueryEvidenceV2Payload = z.infer<typeof queryEvidenceV2PayloadSchema>;
export type ClaimScalarValue = z.infer<typeof claimScalarValueSchema>;
export type ClaimObservationBinding = z.infer<typeof claimObservationBindingSchema>;
export type AtomicClaimPredicate = z.infer<typeof atomicClaimPredicateSchema>;
export type AtomicClaimV2Payload = z.infer<typeof atomicClaimV2PayloadSchema>;
export type EvidenceRelationV2Payload = z.infer<typeof evidenceRelationV2PayloadSchema>;
export type EvidenceCheckReceiptPayload = z.infer<typeof evidenceCheckReceiptPayloadSchema>;
export type EvidenceCheckReceiptV2Payload = z.infer<typeof evidenceCheckReceiptV2PayloadSchema>;
export type SupportDecisionPayload = z.infer<typeof supportDecisionPayloadSchema>;
export type HypothesisAssessmentPayload = z.infer<typeof hypothesisAssessmentPayloadSchema>;
