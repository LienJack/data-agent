/**
 * Internal compatibility facade.
 *
 * Evidence implementation ownership lives under `./evidence/*`. Keep this
 * module for existing package-internal consumers while they migrate to the
 * concrete owners; the package root continues to export the same public names.
 */

export {
  buildEvidenceCheckCandidate,
  buildEvidenceCheckCandidateWithReplayContext,
  buildHypothesisAssessmentCandidate,
  buildHypothesisAssessmentCandidateWithReplayContext,
  buildSupportDecisionCandidate,
  buildSupportDecisionCandidateWithReplayContext,
  resolveEvidenceCheckDerivationWithReplayContext,
  resolveSupportDecisionDerivationWithReplayContext,
} from "./evidence/check-support-assessment.js";
export {
  buildAtomicClaimCandidate,
  buildAtomicClaimCandidateWithReplayContext,
  buildEvidenceRelationCandidate,
  buildEvidenceRelationCandidateWithReplayContext,
  resolveAtomicClaimDerivationWithReplayContext,
  resolveEvidenceRelationDerivationWithReplayContext,
  verifyAtomicClaimDocumentDerivation,
  verifyAtomicClaimDocumentDerivationWithReplayContext,
} from "./evidence/claim-relation.js";
export {
  buildObligationExecutionDecisionCandidate,
  buildObligationExecutionDecisionCandidateWithReplayContext,
  buildQueryEvidenceCandidate,
  buildQueryEvidenceCandidateWithReplayContext,
  type ResolvedObligationExecutionDecisionDerivation,
  resolveObligationExecutionDecisionDerivation,
  resolveObligationExecutionDecisionDerivationWithReplayContext,
  resolveQueryEvidenceDerivationWithReplayContext,
} from "./evidence/oed-query.js";
export {
  createProofDerivationReplayContext,
  type ProofDerivationReplayContext,
  type ResolvedAtomicClaimDerivation,
  type ResolvedEvidenceCheckDerivation,
  type ResolvedEvidenceRelationDerivation,
  type ResolvedQueryEvidenceDerivation,
  type ResolvedSupportDecisionDerivation,
} from "./evidence/proof-replay.js";
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
  type L2ArtifactDocumentFor,
  type L2ArtifactPayloadFor,
  type ResearchDocumentFor,
  type ResearchPayloadFor,
  type ResolvedL2ArtifactDocumentCandidate,
  type ResolvedResearchDocumentCandidate,
  resolveL2ArtifactDocumentCandidate,
  resolveResearchDocumentCandidate,
} from "./internal/document-resolution.js";
