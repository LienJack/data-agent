export {
  type CapabilityProfile,
  type DescriptiveContributionProfile,
  type EndpointExecutionTemplate,
  type FormulaEquivalenceWitness,
  type FormulaSignature,
  type Grain,
  type RowPartitionWitness,
  type RuntimeAuth,
  type RuntimeAuthPredicate,
  type RuntimeAuthTableRule,
  type SemanticDimension,
  type SemanticMetric,
  type SemanticRelationship,
  type SemanticSourceBundle,
  type SemanticSourceBundleMetadata,
  type StaticDriverCapacityProof,
  type TimeDomain,
  type Unit,
  U5_EXECUTABLE_SUBSET,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  assertSemanticSourceBundleInvariants,
  computeExecutableSemanticDigest,
  computeSemanticSourceBundleHash,
  grainSchema,
  semanticSourceBundleSchema,
  unitSchema,
  timeDomainSchema,
  semanticMetricSchema,
  semanticDimensionSchema,
  semanticRelationshipSchema,
  runtimeAuthSchema,
  descriptiveContributionProfileSchema,
  endpointExecutionTemplateSchema,
  staticDriverCapacityProofSchema,
  rowPartitionWitnessSchema,
  formulaEquivalenceWitnessSchema,
  SemanticGovernanceError,
} from "@data-agent/contracts";
export {
  compileU5Projection,
  type U5Projection,
  type U5SemanticProjection,
  type U5RelationshipProjection,
  type U5RuntimeRestrictionProjection,
  type LowerabilityVerdict,
  type CompilationError,
  CompilationErrorCode,
} from "./compiler/u5-compiler.js";
export {
  type LowerabilityProof,
  type LowerabilityResult,
  LowerabilityStatus,
  computeLowerabilityProof,
} from "./compiler/lowerability-proof.js";
export {
  type ExecutableRelationshipEdge,
  type RelationshipProof,
  RelationshipProofKind,
  lowerRelationship,
} from "./compiler/relationship-lowering.js";
export {
  type RuntimeAuthLoweringResult,
  RuntimeAuthLoweringStatus,
  lowerRuntimeAuthorization,
} from "./compiler/runtime-auth-lowering.js";
export {
  type DescriptiveContributionLoweringResult,
  ContributionLoweringStatus,
  lowerDescriptiveContributionProfile,
} from "./compiler/contribution-profile-compiler.js";
export {
  validateSourceBundle,
  type ValidationResult,
  type ValidationIssue,
  ValidationSeverity,
} from "./validation/source-bundle-validator.js";
export {
  type ImpactResult,
  type ImpactEntry,
  ImpactKind,
  computeBundleImpact,
} from "./impact/impact-analyzer.js";
