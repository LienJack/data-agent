import { z } from "zod";
import { appScopeSchema } from "../../common/index.js";
import { artifactReferenceIdentity } from "../envelope.js";
import { modelProfileReferenceSchema } from "./planning.js";
import {
  addUniqueIssues,
  contentHashSchema,
  hmacSha256Schema,
  immutableIdSchema,
  modelProviderSchema,
  nonEmptyTextSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  principalIdSchema,
  shortNonEmptyTextSchema,
  versionIdentifierSchema,
} from "./primitives.js";
import {
  atomicClaimRefSchema,
  coverageStateRefSchema,
  evidencePlanRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  hypothesisSetRefSchema,
  policyReceiptRefSchema,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  reportManifestRefSchema,
  researchBriefRefSchema,
  researchStopDecisionRefSchema,
  schemaSnapshotRefSchema,
  semanticReleaseRefSchema,
  supportDecisionRefSchema,
} from "./references.js";

export const agentProjectionInputRefSchema = z.union([
  researchBriefRefSchema,
  hypothesisSetRefSchema,
  evidencePlanRefSchema,
  queryContractRefSchema,
  semanticReleaseRefSchema,
  schemaSnapshotRefSchema,
  policyReceiptRefSchema,
  queryEvidenceRefSchema,
  atomicClaimRefSchema,
  evidenceRelationRefSchema,
  supportDecisionRefSchema,
  hypothesisAssessmentRefSchema,
  coverageStateRefSchema,
  researchStopDecisionRefSchema,
  reportManifestRefSchema,
]);

export const modelInvocationReservationBindingSchema = z.strictObject({
  reservation_id: immutableIdSchema,
  reservation_seq: positiveIntSchema,
  resource_lease_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  worker_fence: nonNegativeIntSchema,
  request_id: immutableIdSchema,
  canonical_request_digest: contentHashSchema,
  reserved: z.strictObject({
    resource_kind: z.literal("MODEL"),
    input_tokens: nonNegativeIntSchema,
    output_tokens: nonNegativeIntSchema,
    cost_microusd: nonNegativeIntSchema,
    concurrent_slots: z.literal(1),
  }),
});

export const agentDataProjectionReceiptSchema = z
  .strictObject({
    artifact_type: z.literal("AgentDataProjectionReceipt"),
    protocol_version: z.literal("agent-data-projection@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    request_id: immutableIdSchema,
    principal_id: principalIdSchema,
    role: z.enum(["research-supervisor", "semantic-sql", "evidence", "report-projector"]),
    model_profile_ref: modelProfileReferenceSchema,
    model_invocation: modelInvocationReservationBindingSchema,
    provider: modelProviderSchema,
    model_id: shortNonEmptyTextSchema,
    input_refs: z.array(agentProjectionInputRefSchema).min(1).max(32),
    approved_fields: z.array(nonEmptyTextSchema).min(1).max(128),
    inherited_classification: z.enum(["INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
    projected_bytes: nonNegativeIntSchema,
    projected_tokens: nonNegativeIntSchema,
    redaction_count: nonNegativeIntSchema,
    small_group_suppression: z.enum(["PASS", "FAIL"]),
    dlp_scan: z.enum(["PASS", "FAIL"]),
    egress_payload_digest: hmacSha256Schema,
    egress_policy_version: versionIdentifierSchema,
    receipt_hash: contentHashSchema,
  })
  .superRefine((receipt, ctx) => {
    addUniqueIssues(
      receipt.input_refs,
      artifactReferenceIdentity,
      ctx,
      ["input_refs"],
      "Agent Projection Input Reference 必须唯一。",
    );
    addUniqueIssues(
      receipt.approved_fields,
      (value) => value,
      ctx,
      ["approved_fields"],
      "approved_fields 必须唯一。",
    );
    if (
      receipt.provider !== receipt.model_profile_ref.provider ||
      receipt.model_id !== receipt.model_profile_ref.model_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Projection provider/model_id 必须匹配 Model Profile。",
        path: ["model_profile_ref"],
      });
    }
    if (
      receipt.attempt_id !== receipt.model_invocation.attempt_id ||
      receipt.request_id !== receipt.model_invocation.request_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Projection Receipt 必须绑定同一 Model Invocation Attempt/Request。",
        path: ["model_invocation"],
      });
    }
    const scopedReferences = [
      ...receipt.input_refs,
      receipt.model_profile_ref.certification_receipt_ref,
    ];
    if (
      scopedReferences.some(
        (reference) =>
          reference.app_id !== receipt.scope.app_id ||
          reference.tenant_id !== receipt.scope.tenant_id ||
          reference.environment !== receipt.scope.environment ||
          reference.run_id !== receipt.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Projection 的输入与 Model Certification 必须属于同一 Scope/Run。",
        path: ["input_refs"],
      });
    }
  });

export type ModelInvocationReservationBinding = z.infer<
  typeof modelInvocationReservationBindingSchema
>;
export type AgentDataProjectionReceipt = z.infer<typeof agentDataProjectionReceiptSchema>;
