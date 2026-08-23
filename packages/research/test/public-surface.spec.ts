import * as publicApi from "@data-agent/research";
import * as serverApi from "@data-agent/research/server";
import { describe, expect, it } from "vitest";

describe("@data-agent/research 导出边界", () => {
  it("包根只暴露纯 Research Kernel，不暴露 Authority、Fixture 或 Runner", () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [
        "ATOMIC_CLAIM_RENDERER_VERSION",
        "RESEARCH_KERNEL_BOUNDARY_ERROR_CODES",
        "assertCausalClaimAuthorized",
        "assessHypothesisObservation",
        "buildAtomicClaimCandidate",
        "buildEvidenceCheckCandidate",
        "buildEvidenceRelationCandidate",
        "buildHypothesisAssessmentCandidate",
        "buildObligationExecutionDecisionCandidate",
        "buildQueryEvidenceCandidate",
        "buildReportManifestCandidate",
        "buildSupportDecisionCandidate",
        "compileEvidencePlanCandidate",
        "compileHypothesisSetCandidate",
        "compileResearchBriefCandidate",
        "computeAnalysisDerivationHash",
        "computeAnalysisSandboxProgramHash",
        "computeAttributionAuthorityClosureHash",
        "computeCausalEstimateHash",
        "computeCausalQuestionHash",
        "computeIdentificationCertificateHash",
        "computeIdentificationPlanHash",
        "computeRootCauseCandidateHash",
        "computeRootCauseReceiptHash",
        "createCausalEstimate",
        "createCausalQuestion",
        "createIdentificationCertificate",
        "createIdentificationPlan",
        "createRootCauseDiscoveryCandidate",
        "createRootCauseDiscoveryReceipt",
        "deriveContributionClosure",
        "deriveCoverageStateCandidate",
        "derivePreStopReadinessFacts",
        "deriveResearchStopDecisionCandidate",
        "evaluateEvidenceGates",
        "evaluateObservationPredicate",
        "materialSchemaFrontierMatches",
        "projectAnalysisReportCandidate",
        "selectEvidenceGroundedInsights",
        "unresolvedCoverageObligationRefs",
        "verifyAnalysisDerivation",
        "verifyAnalysisSandboxProgram",
        "verifyAnalysisResult",
        "verifyAtomicClaimDocumentDerivation",
        "verifyScaleMetamorphism",
      ].sort(),
    );
    for (const forbidden of [
      "assessHypothesis",
      "createReportReadyCertificateCandidate",
      "createResearchKernelCandidateAuthority",
      "deriveEvidenceCheckReceipt",
      "deriveSupportDecision",
      "evaluateObligationExecution",
      "getControlledFixtureHandle",
      "getTransientOedAssuranceMetadata",
      "issueTransientOedAssuranceFromExactVerifier",
      "materializeControlledProtocolInput",
      "runControlledProtocolKernel",
      "sealKernelVerifiedReportReadyCandidate",
    ]) {
      expect(forbidden in publicApi).toBe(false);
    }
  });

  it("server 子路径只开放受控输入、真实 Runner 与候选身份，不暴露 raw oracle", () => {
    expect(Object.keys(serverApi).sort()).toEqual(
      [
        "buildFrozenQueryRegistryOedCandidate",
        "createResearchKernelCandidateAuthority",
        "getControlledFixtureHandle",
        "getKernelVerifiedCandidateMetadata",
        "isControlledFixtureHandle",
        "isKernelVerifiedReportReadyCandidate",
        "isResearchKernelCandidateAuthority",
        "materializeControlledProtocolInput",
        "runControlledProtocolKernel",
        "sealKernelVerifiedReportReadyCandidate",
      ].sort(),
    );
    for (const forbidden of [
      "readControlledFixtureContract",
      "listControlledMutationCases",
      "listControlledPairCases",
      "projectControlledProtocolInputFromFixture",
      "getTransientOedAssuranceMetadata",
      "issueTransientOedAssuranceFromExactVerifier",
    ]) {
      expect(forbidden in serverApi).toBe(false);
    }
  });
});
