export type { GateReceiptProjectionInput } from "./artifacts/payload-projection.js";
export {
  createGateReceiptPayload,
  createGroundingPackagePayload,
  createLogicalPlanPayload,
  createSemanticQueryPayload,
} from "./artifacts/payload-projection.js";
export type {
  PostgresqlCompilation,
  PostgresqlCompilationProof,
  PostgresqlCompilationReasonCode,
  PostgresqlCompilationResult,
  PostgresqlCompilerInput,
  PostgresqlParameterOrderEntry,
  PostgresqlQueryAst,
  SqlDialectCompilerInput,
} from "./compiler/index.js";
export {
  compilePostgresqlLogicalPlan,
  compileSqlDialect,
  isPostgresqlCompilation,
  POSTGRESQL_COMPILATION_REASON_CODES,
  POSTGRESQL_COMPILER_VERSION,
} from "./compiler/index.js";
export {
  compileQueryContract,
  type QueryContractCompilation,
  type QueryContractCompilerInput,
  type QueryContractResolution,
} from "./contracts/query-contract.js";
export {
  computeResultOracleEvidenceHash,
  computeSqlSandboxInputHash,
  type EvaluatePostExecutionGatesInput,
  evaluatePostExecutionGates,
  TEXT2SQL_SQL_SANDBOX_MAX_MEMORY_MB,
} from "./gates/post-execution.js";
export {
  type EvaluatePreExecutionGatesInput,
  evaluatePreExecutionGates,
} from "./gates/pre-execution.js";
export type {
  ExecutionGateReasonCode,
  IntentGateReasonCode,
  PolicyGateReasonCode,
  ResourceGateReasonCode,
  ResultGateReasonCode,
  SemanticGateReasonCode,
  StructuralGateReasonCode,
} from "./gates/reason-codes.js";
export {
  EXECUTION_GATE_REASON_CODES,
  INTENT_GATE_REASON_CODES,
  POLICY_GATE_REASON_CODES,
  RESOURCE_GATE_REASON_CODES,
  RESULT_GATE_REASON_CODES,
  SEMANTIC_GATE_REASON_CODES,
  STRUCTURAL_GATE_REASON_CODES,
} from "./gates/reason-codes.js";
export {
  type SealExecutionPermitInput,
  type SealValidationReceiptInput,
  sealExecutionPermit,
  sealValidationReceipt,
} from "./gates/seal.js";
export type {
  GateObservationMap,
  GateVerdict,
  PostExecutionGate,
  PostExecutionGateSuite,
  PostgresqlExplainEstimate,
  PreExecutionGate,
  PreExecutionGateSuite,
  ResourcePolicy,
  ResultOracleAuthority,
  ResultOracleVerdict,
  Text2SqlGate,
  TrustedGateEvaluation,
} from "./gates/types.js";
export {
  postgresqlExplainEstimateSchema,
  resourcePolicySchema,
  resultOracleVerdictSchema,
  TEXT2SQL_GATE_EVALUATOR_VERSION,
  TEXT2SQL_GATE_REASON_CODES,
} from "./gates/types.js";
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
