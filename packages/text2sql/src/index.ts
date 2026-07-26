export {
  createGroundingPackagePayload,
  createLogicalPlanPayload,
  createSemanticQueryPayload,
} from "./artifacts/payload-projection.js";
export {
  compileQueryContract,
  type QueryContractCompilation,
  type QueryContractCompilerInput,
  type QueryContractResolution,
} from "./contracts/query-contract.js";
export {
  type AclFirstGrounderDependencies,
  type AclFirstGroundingInput,
  createAclFirstGrounder,
  type GroundingCatalogPort,
  type GroundingPolicyPort,
  type GroundingRetrievalPort,
} from "./grounding/acl-first-grounder.js";
export type {
  CatalogSnapshot,
  GroundingPackageDraft,
  GroundingResult,
  PolicySnapshot,
} from "./grounding/types.js";
export { buildLogicalPlan } from "./planning/build-logical-plan.js";
export type { LogicalPlanDraft } from "./planning/types.js";
export {
  isValidatedLogicalPlan,
  LOGICAL_PLAN_VALIDATION_REASON_CODES,
  type LogicalPlanValidationReasonCode,
  type LogicalPlanValidationResult,
  type ValidatedLogicalPlan,
  validateLogicalPlan,
} from "./planning/validate-logical-plan.js";
export { buildSemanticQuery } from "./semantic/build-semantic-query.js";
export type { SemanticQueryDraft } from "./semantic/types.js";
