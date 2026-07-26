import {
  deepFreeze,
  type GroundingPackagePayload,
  groundingPackageSchema,
  type LogicalPlanPayload,
  logicalPlanSchema,
  type SemanticQueryPayload,
  semanticQuerySchema,
} from "@data-agent/contracts";
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
