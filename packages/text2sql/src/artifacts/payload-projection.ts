import {
  artifactReferenceIdentity,
  artifactReferenceSchema,
  computeGateEvaluationHash,
  computeGateInputHash,
  deepFreeze,
  type GateReceiptPayload,
  type GroundingPackagePayload,
  gateReceiptSchema,
  groundingPackageSchema,
  type LogicalPlanPayload,
  logicalPlanSchema,
  type SemanticQueryPayload,
  semanticQuerySchema,
} from "@data-agent/contracts";
import { isTrustedGateEvaluation } from "../gates/internal.js";
import type { TrustedGateEvaluation } from "../gates/types.js";
import { type GroundingPackageDraft, groundingPackageDraftSchema } from "../grounding/types.js";
import {
  isValidatedLogicalPlan,
  type ValidatedLogicalPlan,
} from "../planning/validate-logical-plan.js";
import { type SemanticQueryDraft, semanticQueryDraftSchema } from "../semantic/types.js";

export interface GroundingPackageProjectionInput {
  readonly draft: GroundingPackageDraft;
  readonly query_contract_ref: GroundingPackagePayload["query_contract_ref"];
  readonly semantic_release_ref: GroundingPackagePayload["semantic_release_ref"];
  readonly schema_snapshot_ref: GroundingPackagePayload["schema_snapshot_ref"];
  readonly policy_receipt_ref: GroundingPackagePayload["policy_receipt_ref"];
}

export interface SemanticQueryProjectionInput {
  readonly draft: SemanticQueryDraft;
  readonly query_contract_ref: SemanticQueryPayload["query_contract_ref"];
  readonly grounding_package_ref: SemanticQueryPayload["grounding_package_ref"];
}

export interface LogicalPlanProjectionInput {
  readonly draft: ValidatedLogicalPlan;
  readonly semantic_query_ref: LogicalPlanPayload["semantic_query_ref"];
}

export interface GateReceiptProjectionInput {
  readonly evaluation: TrustedGateEvaluation;
  readonly sql_artifact_ref: GateReceiptPayload["sql_artifact_ref"];
  readonly execution_receipt_ref: GateReceiptPayload["execution_receipt_ref"];
}

export function createGroundingPackagePayload(
  input: GroundingPackageProjectionInput,
): GroundingPackagePayload {
  const draft = groundingPackageDraftSchema.parse(input.draft);
  return deepFreeze(
    groundingPackageSchema.parse({
      ...draft,
      artifact_type: "GroundingPackage",
      query_contract_ref: input.query_contract_ref,
      semantic_release_ref: input.semantic_release_ref,
      schema_snapshot_ref: input.schema_snapshot_ref,
      policy_receipt_ref: input.policy_receipt_ref,
    }),
  );
}

export function createSemanticQueryPayload(
  input: SemanticQueryProjectionInput,
): SemanticQueryPayload {
  const draft = semanticQueryDraftSchema.parse(input.draft);
  return deepFreeze(
    semanticQuerySchema.parse({
      ...draft,
      artifact_type: "SemanticQuery",
      query_contract_ref: input.query_contract_ref,
      grounding_package_ref: input.grounding_package_ref,
    }),
  );
}

export function createLogicalPlanPayload(input: LogicalPlanProjectionInput): LogicalPlanPayload {
  if (!isValidatedLogicalPlan(input.draft)) {
    throw new TypeError("LOGICAL_PLAN_VALIDATION_REQUIRED");
  }
  return deepFreeze(
    logicalPlanSchema.parse({
      ...input.draft,
      artifact_type: "LogicalPlan",
      semantic_query_ref: input.semantic_query_ref,
    }),
  );
}

export async function createGateReceiptPayload(
  input: GateReceiptProjectionInput,
): Promise<GateReceiptPayload> {
  if (!isTrustedGateEvaluation(input.evaluation)) {
    throw new TypeError("GATE_EVALUATION_AUTHORITY_REQUIRED");
  }
  const sqlArtifactReference = artifactReferenceSchema.parse(input.sql_artifact_ref);
  if (
    sqlArtifactReference.artifact_type !== "SqlArtifact" ||
    artifactReferenceIdentity(sqlArtifactReference) !==
      artifactReferenceIdentity(input.evaluation.sql_artifact_ref)
  ) {
    throw new TypeError("GATE_EVALUATION_SQL_ARTIFACT_BINDING_MISMATCH");
  }
  const executionReceiptReference =
    input.execution_receipt_ref === null
      ? null
      : artifactReferenceSchema.parse(input.execution_receipt_ref);
  if (
    (executionReceiptReference !== null &&
      executionReceiptReference.artifact_type !== "ExecutionReceipt") ||
    (executionReceiptReference === null) !== (input.evaluation.execution_receipt_ref === null) ||
    (executionReceiptReference !== null &&
      input.evaluation.execution_receipt_ref !== null &&
      artifactReferenceIdentity(executionReceiptReference) !==
        artifactReferenceIdentity(input.evaluation.execution_receipt_ref))
  ) {
    throw new TypeError("GATE_EVALUATION_EXECUTION_RECEIPT_BINDING_MISMATCH");
  }
  const inputMaterial = {
    artifact_type: "GateReceipt" as const,
    sql_artifact_ref: sqlArtifactReference,
    execution_receipt_ref: executionReceiptReference,
    gate: input.evaluation.gate,
    gate_version: input.evaluation.gate_version,
    evaluator_version: input.evaluation.gate_version,
    evidence_refs: [...input.evaluation.evidence_refs],
  };
  const inputHash = await computeGateInputHash(inputMaterial);
  const evaluationMaterial = {
    ...inputMaterial,
    input_hash: inputHash,
    evaluator_input_hash: input.evaluation.input_hash,
    evaluator_evaluation_hash: input.evaluation.evaluation_hash,
    verdict: input.evaluation.verdict,
    reason_code: input.evaluation.reason_code,
    observations: input.evaluation.observations,
    evaluated_at: input.evaluation.evaluated_at,
  };
  const evaluationHash = await computeGateEvaluationHash(evaluationMaterial);
  return deepFreeze(
    gateReceiptSchema.parse({
      ...evaluationMaterial,
      evaluation_hash: evaluationHash,
    }),
  );
}
