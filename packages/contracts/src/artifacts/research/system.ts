import { z } from "zod";
import { appScopeSchema, sha256ContentHash } from "../../common/index.js";
import { artifactReferenceIdentity, artifactReferenceSchema } from "../envelope.js";
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

const agentDataProjectionReceiptV2DraftSchema = z
  .strictObject({
    artifact_type: z.literal("AgentDataProjectionReceipt"),
    protocol_version: z.literal("agent-data-projection@2.0.0"),
    receipt_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    request_id: immutableIdSchema,
    principal_id: principalIdSchema,
    model_execution_profile_hash: contentHashSchema,
    input_refs: z.array(artifactReferenceSchema).min(1).max(64),
    approved_fields: z.array(nonEmptyTextSchema).min(1).max(256),
    classification: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"]),
    payload_hash: contentHashSchema,
    token_bound_policy_version: z.literal("utf8-byte-upper-bound@1.0.0"),
    trusted_input_token_upper_bound: nonNegativeIntSchema,
    redaction: z.strictObject({
      count: nonNegativeIntSchema,
      policy_version: versionIdentifierSchema,
    }),
    dlp: z.strictObject({
      status: z.literal("PASS"),
      policy_version: versionIdentifierSchema,
    }),
    taint: z.strictObject({
      policy_version: versionIdentifierSchema,
      taint_hash: contentHashSchema,
    }),
  })
  .superRefine((receipt, ctx) => {
    if (receipt.receipt_id !== receipt.request_id) {
      ctx.addIssue({
        code: "custom",
        message: "Projection v2 receipt_id 必须等于 logical Provider invocation request_id。",
        path: ["receipt_id"],
      });
    }
    receipt.input_refs.forEach((reference, index) => {
      const identity = artifactReferenceIdentity(reference);
      const previous = receipt.input_refs[index - 1];
      if (previous && artifactReferenceIdentity(previous) >= identity) {
        ctx.addIssue({
          code: "custom",
          message: "Projection input refs 必须唯一且规范排序。",
          path: ["input_refs", index],
        });
      }
      if (
        reference.app_id !== receipt.scope.app_id ||
        reference.tenant_id !== receipt.scope.tenant_id ||
        reference.environment !== receipt.scope.environment ||
        reference.run_id !== receipt.run_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Projection input ref 必须同 Scope/Run。",
          path: ["input_refs", index],
        });
      }
    });
    receipt.approved_fields.forEach((field, index) => {
      const previous = receipt.approved_fields[index - 1];
      if (previous !== undefined && previous >= field) {
        ctx.addIssue({
          code: "custom",
          message: "approved_fields 必须唯一且规范排序。",
          path: ["approved_fields", index],
        });
      }
    });
  });

export const agentDataProjectionReceiptV2Schema =
  agentDataProjectionReceiptV2DraftSchema.safeExtend({ receipt_hash: contentHashSchema });

export async function computeAgentDataProjectionReceiptV2Hash(input: unknown) {
  return sha256ContentHash(agentDataProjectionReceiptV2DraftSchema.parse(input));
}

export async function buildAgentDataProjectionReceiptV2Candidate(input: unknown) {
  const receipt = agentDataProjectionReceiptV2DraftSchema.parse(input);
  return agentDataProjectionReceiptV2Schema.parse({
    ...receipt,
    receipt_hash: await computeAgentDataProjectionReceiptV2Hash(receipt),
  });
}

export async function verifyAgentDataProjectionReceiptV2Candidate(input: unknown) {
  const receipt = agentDataProjectionReceiptV2Schema.parse(input);
  const { receipt_hash: _receiptHash, ...draft } = receipt;
  if ((await computeAgentDataProjectionReceiptV2Hash(draft)) !== receipt.receipt_hash) {
    throw new TypeError("AGENT_DATA_PROJECTION_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export type AgentDataProjectionReceiptV2 = z.infer<typeof agentDataProjectionReceiptV2Schema>;
