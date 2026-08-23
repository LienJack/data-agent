import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
} from "../envelope.js";
import { identifierSchema } from "./primitives.js";

export const U6_REFERENCE_TARGETS = [
  "QuestionFrame",
  "ResearchBrief",
  "HypothesisSet",
  "EvidencePlan",
  "QueryContract",
  "SemanticRelease",
  "SchemaSnapshot",
  "PolicyReceipt",
  "SqlArtifact",
  "ValidationReceipt",
  "ExecutionReceipt",
  "SandboxResult",
  "SandboxExecutionReceipt",
  "ObligationExecutionDecision",
  "QueryEvidence",
  "DataProfile",
  "AnalysisProgram",
  "DerivedAnalysisEvidence",
  "AnalysisCompletionReceipt",
  "SandboxProgram",
  "DiscoveryCandidate",
  "DiscoveryReceipt",
  "CausalQuestion",
  "IdentificationPlan",
  "CausalEstimate",
  "IdentificationCertificate",
  "AtomicClaim",
  "EvidenceRelation",
  "EvidenceCheckReceipt",
  "SupportDecision",
  "HypothesisAssessment",
  "CoverageState",
  "ResearchStopDecision",
  "ReportManifest",
  "AnalysisReport",
  "ReportProjectionReceipt",
  "EvidenceGateReceipt",
  "ReportReadyCertificate",
  "ReadinessRevocationReceipt",
  "ModelCertificationReceipt",
] as const;

export type U6ReferenceTarget = (typeof U6_REFERENCE_TARGETS)[number];
export type TypedArtifactReference<T extends U6ReferenceTarget> = ArtifactReference & {
  artifact_type: T;
};

export const questionFrameRefSchema = artifactReferenceFor("QuestionFrame");
export const researchBriefRefSchema = artifactReferenceFor("ResearchBrief");
export const hypothesisSetRefSchema = artifactReferenceFor("HypothesisSet");
export const evidencePlanRefSchema = artifactReferenceFor("EvidencePlan");
export const queryContractRefSchema = artifactReferenceFor("QueryContract");
export const semanticReleaseRefSchema = artifactReferenceFor("SemanticRelease");
export const schemaSnapshotRefSchema = artifactReferenceFor("SchemaSnapshot");
export const policyReceiptRefSchema = artifactReferenceFor("PolicyReceipt");
export const sqlArtifactRefSchema = artifactReferenceFor("SqlArtifact");
export const validationReceiptRefSchema = artifactReferenceFor("ValidationReceipt");
export const executionReceiptRefSchema = artifactReferenceFor("ExecutionReceipt");
export const sandboxResultRefSchema = artifactReferenceFor("SandboxResult");
export const sandboxExecutionReceiptRefSchema = artifactReferenceFor("SandboxExecutionReceipt");
export const obligationExecutionDecisionRefSchema = artifactReferenceFor(
  "ObligationExecutionDecision",
);
export const queryEvidenceRefSchema = artifactReferenceFor("QueryEvidence");
export const dataProfileRefSchema = artifactReferenceFor("DataProfile");
export const analysisProgramRefSchema = artifactReferenceFor("AnalysisProgram");
export const derivedAnalysisEvidenceRefSchema = artifactReferenceFor("DerivedAnalysisEvidence");
export const analysisCompletionReceiptRefSchema = artifactReferenceFor("AnalysisCompletionReceipt");
export const sandboxProgramRefSchema = artifactReferenceFor("SandboxProgram");
export const discoveryCandidateRefSchema = artifactReferenceFor("DiscoveryCandidate");
export const discoveryReceiptRefSchema = artifactReferenceFor("DiscoveryReceipt");
export const causalQuestionRefSchema = artifactReferenceFor("CausalQuestion");
export const identificationPlanRefSchema = artifactReferenceFor("IdentificationPlan");
export const causalEstimateRefSchema = artifactReferenceFor("CausalEstimate");
export const identificationCertificateRefSchema = artifactReferenceFor("IdentificationCertificate");
export const atomicClaimRefSchema = artifactReferenceFor("AtomicClaim");
export const evidenceRelationRefSchema = artifactReferenceFor("EvidenceRelation");
export const evidenceCheckReceiptRefSchema = artifactReferenceFor("EvidenceCheckReceipt");
export const supportDecisionRefSchema = artifactReferenceFor("SupportDecision");
export const hypothesisAssessmentRefSchema = artifactReferenceFor("HypothesisAssessment");
export const coverageStateRefSchema = artifactReferenceFor("CoverageState");
export const researchStopDecisionRefSchema = artifactReferenceFor("ResearchStopDecision");
export const reportManifestRefSchema = artifactReferenceFor("ReportManifest");
export const analysisReportRefSchema = artifactReferenceFor("AnalysisReport");
export const reportProjectionReceiptRefSchema = artifactReferenceFor("ReportProjectionReceipt");
export const evidenceGateReceiptRefSchema = artifactReferenceFor("EvidenceGateReceipt");
export const reportReadyCertificateRefSchema = artifactReferenceFor("ReportReadyCertificate");
export const readinessRevocationReceiptRefSchema = artifactReferenceFor(
  "ReadinessRevocationReceipt",
);
export const modelCertificationReceiptRefSchema = artifactReferenceFor("ModelCertificationReceipt");

function embeddedNodeReferenceFor<
  const T extends "ResearchBrief" | "HypothesisSet" | "EvidencePlan" | "SemanticRelease",
>(artifactType: T) {
  return z.strictObject({
    container_ref: artifactReferenceFor(artifactType),
    node_id: identifierSchema,
  });
}

export const successCriterionRefSchema = embeddedNodeReferenceFor("ResearchBrief");
export const hypothesisRefSchema = embeddedNodeReferenceFor("HypothesisSet");
export const proofObligationRefSchema = embeddedNodeReferenceFor("EvidencePlan");
export const metricRefSchema = embeddedNodeReferenceFor("SemanticRelease");
export const localProofObligationReferenceSchema = z.strictObject({
  node_id: identifierSchema,
});

export function embeddedNodeReferenceIdentity(reference: {
  container_ref: ArtifactReference;
  node_id: string;
}): string {
  return `${artifactReferenceIdentity(reference.container_ref)}\0${reference.node_id}`;
}

export type QuestionFrameRef = z.infer<typeof questionFrameRefSchema>;
export type ResearchBriefRef = z.infer<typeof researchBriefRefSchema>;
export type HypothesisSetRef = z.infer<typeof hypothesisSetRefSchema>;
export type EvidencePlanRef = z.infer<typeof evidencePlanRefSchema>;
export type QueryContractRef = z.infer<typeof queryContractRefSchema>;
export type SemanticReleaseRef = z.infer<typeof semanticReleaseRefSchema>;
export type SchemaSnapshotRef = z.infer<typeof schemaSnapshotRefSchema>;
export type PolicyReceiptRef = z.infer<typeof policyReceiptRefSchema>;
export type SqlArtifactRef = z.infer<typeof sqlArtifactRefSchema>;
export type ValidationReceiptRef = z.infer<typeof validationReceiptRefSchema>;
export type ExecutionReceiptRef = z.infer<typeof executionReceiptRefSchema>;
export type SandboxResultRef = z.infer<typeof sandboxResultRefSchema>;
export type SandboxExecutionReceiptRef = z.infer<typeof sandboxExecutionReceiptRefSchema>;
export type ObligationExecutionDecisionRef = z.infer<typeof obligationExecutionDecisionRefSchema>;
export type QueryEvidenceRef = z.infer<typeof queryEvidenceRefSchema>;
export type DataProfileRef = z.infer<typeof dataProfileRefSchema>;
export type AnalysisProgramRef = z.infer<typeof analysisProgramRefSchema>;
export type DerivedAnalysisEvidenceRef = z.infer<typeof derivedAnalysisEvidenceRefSchema>;
export type AnalysisCompletionReceiptRef = z.infer<typeof analysisCompletionReceiptRefSchema>;
export type SandboxProgramRef = z.infer<typeof sandboxProgramRefSchema>;
export type DiscoveryCandidateRef = z.infer<typeof discoveryCandidateRefSchema>;
export type DiscoveryReceiptRef = z.infer<typeof discoveryReceiptRefSchema>;
export type CausalQuestionRef = z.infer<typeof causalQuestionRefSchema>;
export type IdentificationPlanRef = z.infer<typeof identificationPlanRefSchema>;
export type CausalEstimateRef = z.infer<typeof causalEstimateRefSchema>;
export type IdentificationCertificateRef = z.infer<typeof identificationCertificateRefSchema>;
export type AtomicClaimRef = z.infer<typeof atomicClaimRefSchema>;
export type EvidenceRelationRef = z.infer<typeof evidenceRelationRefSchema>;
export type EvidenceCheckReceiptRef = z.infer<typeof evidenceCheckReceiptRefSchema>;
export type SupportDecisionRef = z.infer<typeof supportDecisionRefSchema>;
export type HypothesisAssessmentRef = z.infer<typeof hypothesisAssessmentRefSchema>;
export type CoverageStateRef = z.infer<typeof coverageStateRefSchema>;
export type ResearchStopDecisionRef = z.infer<typeof researchStopDecisionRefSchema>;
export type ReportManifestRef = z.infer<typeof reportManifestRefSchema>;
export type AnalysisReportRef = z.infer<typeof analysisReportRefSchema>;
export type ReportProjectionReceiptRef = z.infer<typeof reportProjectionReceiptRefSchema>;
export type EvidenceGateReceiptRef = z.infer<typeof evidenceGateReceiptRefSchema>;
export type ReportReadyCertificateRef = z.infer<typeof reportReadyCertificateRefSchema>;
export type ReadinessRevocationReceiptRef = z.infer<typeof readinessRevocationReceiptRefSchema>;
export type ModelCertificationReceiptRef = z.infer<typeof modelCertificationReceiptRefSchema>;
export type SuccessCriterionRef = z.infer<typeof successCriterionRefSchema>;
export type HypothesisRef = z.infer<typeof hypothesisRefSchema>;
export type ProofObligationRef = z.infer<typeof proofObligationRefSchema>;
export type MetricRef = z.infer<typeof metricRefSchema>;
export type LocalProofObligationReference = z.infer<typeof localProofObligationReferenceSchema>;
