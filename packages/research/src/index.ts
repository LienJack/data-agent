export {
  type AcceptedInsightClaim,
  assertCausalClaimAuthorized,
  type CausalEstimateComputation,
  computeAnalysisDerivationHash,
  computeAnalysisSandboxProgramHash,
  computeAttributionAuthorityClosureHash,
  computeCausalEstimateHash,
  computeCausalQuestionHash,
  computeIdentificationCertificateHash,
  computeIdentificationPlanHash,
  computeRootCauseCandidateHash,
  computeRootCauseReceiptHash,
  createCausalEstimate,
  createCausalQuestion,
  createIdentificationCertificate,
  createIdentificationPlan,
  createRootCauseDiscoveryCandidate,
  createRootCauseDiscoveryReceipt,
  type DerivationFailure,
  type InsightCandidate,
  type InsightTier,
  type OracleFailure,
  type ProgramVerification,
  type ProgramVerificationFailure,
  type ResultOracleVerdict,
  type RootCauseFactorObservation,
  type SelectedInsight,
  selectEvidenceGroundedInsights,
  verifyAnalysisDerivation,
  verifyAnalysisResult,
  verifyAnalysisSandboxProgram,
  verifyScaleMetamorphism,
} from "./analysis-evidence/index.js";
export {
  type AtomicClaimDocumentResolution,
  type DeriveCoverageStateInput,
  deriveCoverageStateCandidate,
  type EvidenceCheckDocumentResolution,
  type EvidenceRelationDocumentResolution,
  type HypothesisAssessmentDocumentResolution,
  type ObligationBlocker,
  type QueryEvidenceDocumentResolution,
  type SupportDecisionDocumentResolution,
  unresolvedCoverageObligationRefs,
} from "./coverage.js";
export {
  RESEARCH_KERNEL_BOUNDARY_ERROR_CODES,
  type ResearchKernelBoundaryErrorCode,
  type ResearchKernelError,
  type ResearchKernelErrorCode,
  type ResearchKernelResult,
} from "./errors.js";
export {
  buildEvidenceCheckCandidate,
  buildHypothesisAssessmentCandidate,
  buildSupportDecisionCandidate,
} from "./evidence/check-support-assessment.js";
export {
  buildAtomicClaimCandidate,
  buildEvidenceRelationCandidate,
  verifyAtomicClaimDocumentDerivation,
} from "./evidence/claim-relation.js";
export {
  buildObligationExecutionDecisionCandidate,
  buildQueryEvidenceCandidate,
} from "./evidence/oed-query.js";
export {
  ATOMIC_CLAIM_RENDERER_VERSION,
  type AtomicClaimDerivationResolution,
  type AtomicClaimIntent,
  type AtomicClaimRendererInput,
  type BuildAtomicClaimCandidateInput,
  type BuildEvidenceCheckCandidateInput,
  type BuildEvidenceRelationCandidateInput,
  type BuildHypothesisAssessmentCandidateInput,
  type BuildObligationExecutionDecisionCandidateInput,
  type BuildQueryEvidenceCandidateInput,
  type BuildSupportDecisionCandidateInput,
  type ClaimObservationSelector,
  type ClaimObservationSource,
  type EvidenceCheckDerivationResolution,
  type EvidenceRelationDerivationResolution,
  type ObligationExecutionDecisionDocumentResolution,
  type QueryEvidenceDerivationResolution,
  type QueryEvidenceL2Closure,
  type QueryEvidenceSandboxClosure,
  type ResolvedProofObligation,
  type SupportDecisionDerivationResolution,
  type VerifyAtomicClaimDocumentDerivationInput,
} from "./evidence/shared.js";
export {
  materialSchemaFrontierMatches,
  type SchemaFrontierBinding,
} from "./evidence.js";
export {
  assessHypothesisObservation,
  type ContributionClosure,
  type ContributionClosureInput,
  deriveContributionClosure,
  evaluateObservationPredicate,
  type HypothesisObservationInput,
  type HypothesisObservationStatus,
  type ObservationEvaluation,
  type ObservationEvaluationInput,
} from "./observation.js";
export {
  compileEvidencePlanCandidate,
  compileHypothesisSetCandidate,
  compileResearchBriefCandidate,
  type EvidencePlanCandidateInput,
  type HypothesisCandidateInput,
  type HypothesisSetCandidateInput,
  type ProofObligationCandidateInput,
  type ResearchBriefCandidateInput,
} from "./planning.js";
export {
  derivePreStopReadinessFacts,
  type PreStopReadinessFacts,
  type PreStopReadinessInput,
} from "./pre-stop-readiness.js";
export {
  type EvidenceGateCandidateBundle,
  type EvidenceGateFacts,
  evaluateEvidenceGates,
  type ReadinessSupportResolution,
} from "./readiness/evidence-gates.js";
export type { GateReceiptReferences } from "./readiness/report-ready-certificate.js";
export {
  type BuildReportManifestInput,
  buildReportManifestCandidate,
  type ProjectAnalysisReportInput,
  type ProjectedReportCandidate,
  projectAnalysisReportCandidate,
  type ResolvedReportArtifact,
  type WriterProjectionCandidate,
} from "./reporting.js";
export {
  type DeriveResearchStopDecisionInput,
  deriveResearchStopDecisionCandidate,
  type PreStopReadinessDocumentInput,
  type QueryCandidateFacts,
  type ReplanFacts,
  type SupportedClaimResolution,
} from "./stop.js";
