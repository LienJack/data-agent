export {
  assertSemanticSourceBundleInvariants,
  type BindingLifecycle,
  type BusinessEntity,
  type BusinessEntityRelationshipType,
  type BusinessEvent,
  type BusinessOntology,
  type BusinessTerm,
  bindingLifecycleSchema,
  businessEntityRelationshipTypeSchema,
  businessEntitySchema,
  businessEventSchema,
  businessOntologySchema,
  businessTermSchema,
  type CapabilityProfile,
  type CatalogGovernance,
  type ColumnGovernance,
  catalogGovernanceSchema,
  columnGovernanceSchema,
  computeExecutableSemanticDigest,
  computeSemanticSourceBundleHash,
  type DescriptiveContributionProfile,
  type DriverCapacityConstraint,
  descriptiveContributionProfileSchema,
  driverCapacityConstraintSchema,
  type EndpointExecutionTemplate,
  endpointExecutionTemplateSchema,
  type FormulaEquivalenceWitness,
  type FormulaSignature,
  formulaEquivalenceWitnessSchema,
  type Grain,
  grainSchema,
  type PhysicalBinding,
  type PhysicalBindingEntry,
  physicalBindingEntrySchema,
  physicalBindingSchema,
  type RowPartitionWitness,
  type RuntimeAuth,
  type RuntimeAuthPredicate,
  type RuntimeAuthTableRule,
  rowPartitionWitnessSchema,
  runtimeAuthSchema,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  type SemanticDimension,
  SemanticGovernanceError,
  type SemanticMetric,
  type SemanticRelationship,
  type SemanticSourceBundle,
  type SemanticSourceBundleMetadata,
  semanticDimensionSchema,
  semanticMetricSchema,
  semanticRelationshipSchema,
  semanticSourceBundleSchema,
  type TableGovernance,
  type TimeDomain,
  tableGovernanceSchema,
  timeDomainSchema,
  U5_EXECUTABLE_SUBSET,
  U13_EXECUTABLE_SUBSET,
  type Unit,
  unitSchema,
} from "@data-agent/contracts";
export * from "./authoring/index.js";
export * from "./read-model/index.js";
export {
  ContributionLoweringStatus,
  type DescriptiveContributionLoweringResult,
  lowerDescriptiveContributionProfile,
} from "./compiler/contribution-profile-compiler.js";
export * from "./graph-v2/canonicalize.js";
export * from "./graph-v2/compiler.js";
export * from "./graph-v2/errors.js";
export * from "./graph-v2/ontology-package.js";
export * from "./graph-v2/patch-reducer.js";
export * from "./graph-v2/validator.js";
export {
  computeLowerabilityProof,
  type LowerabilityProof,
  type LowerabilityResult,
  LowerabilityStatus,
} from "./compiler/lowerability-proof.js";
export {
  type ExecutableRelationshipEdge,
  lowerRelationship,
  type RelationshipProof,
  RelationshipProofKind,
} from "./compiler/relationship-lowering.js";
export {
  lowerRuntimeAuthorization,
  type RuntimeAuthLoweringResult,
  RuntimeAuthLoweringStatus,
} from "./compiler/runtime-auth-lowering.js";
export {
  type CompilationError,
  CompilationErrorCode,
  compileU5Projection,
  deriveSemanticExplorerSidecar,
  type LowerabilityVerdict,
  type U5Projection,
  type U5RelationshipProjection,
  type U5RuntimeRestrictionProjection,
  type U5SemanticProjection,
} from "./compiler/u5-compiler.js";
export {
  buildSemanticExplorerCandidateComparison,
  buildSemanticExplorerLineage,
  buildSemanticExplorerReadModel,
  buildSemanticExplorerSnapshot,
  diffSemanticExplorerSnapshots,
  SemanticExplorerKernelError,
  type SemanticExplorerLineageOptions,
  type SemanticExplorerReadModel,
  type SemanticExplorerSearchEntry,
  semanticExplorerIdentityKey,
} from "./explorer/index.js";
export {
  computeBundleImpact,
  type ImpactEntry,
  ImpactKind,
  type ImpactResult,
} from "./impact/impact-analyzer.js";
export {
  buildSemanticRelationshipGraphManifest,
  createSemanticRelationshipSearchService,
  type SemanticRelationshipCheckpointReader,
  type SemanticRelationshipGraphSearchPort,
  SemanticRelationshipIndexKernelError,
  type SemanticRelationshipIndexKernelErrorCode,
  type SemanticRelationshipSearchAuthority,
  type SemanticRelationshipSearchService,
  type SemanticRelationshipSnapshotReader,
  searchSemanticRelationshipGraphFallback,
} from "./relationship-index/index.js";
export {
  type ValidationIssue,
  type ValidationResult,
  ValidationSeverity,
  validateSourceBundle,
} from "./validation/source-bundle-validator.js";
