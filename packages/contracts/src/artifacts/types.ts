import { z } from "zod";

export const L2_ARTIFACT_TYPES = [
  "QuestionFrame",
  "ResearchBrief",
  "HypothesisSet",
  "EvidencePlan",
  "QueryContract",
  "GroundingPackage",
  "SemanticQuery",
  "LogicalPlan",
  "SqlArtifact",
  "GateReceipt",
  "ExecutionPermit",
  "ValidationReceipt",
  "ExecutionReceipt",
  "QueryEvidence",
  "AtomicClaim",
  "EvidenceRelation",
  "ObligationExecutionDecision",
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
] as const;

export const DEFERRED_ARTIFACT_TYPES = [
  "ExperimentPlan",
  "ExperimentResult",
  "ResultCertificate",
  "ObservationSpec",
  "DiscoveryCandidate",
  "DiscoveryReceipt",
  "CausalQuestion",
  "IdentificationPlan",
  "CausalEstimate",
  "IdentificationCertificate",
] as const;

export const SYSTEM_ARTIFACT_TYPES = [
  "ReleaseManifest",
  "EvalCase",
  "EvalRegistryAssignment",
  "EvalRun",
  "OracleVerdictReceipt",
  "ScoreCard",
  "ModelCertificationReceipt",
  "ExternalAgentAuditReceipt",
  "SandboxProgram",
  "ResourceAdmissionReceipt",
  "FixtureMutationRecord",
  "MetamorphicFixtureReceipt",
  "MetamorphicOracleReceipt",
  "ResultOracleReceipt",
  "SandboxResult",
  "SandboxExecutionReceipt",
  "BenchmarkAdapterReceipt",
  "SemanticRelease",
  "SchemaSnapshot",
  "PolicyReceipt",
  "AgentDataProjectionReceipt",
] as const;

export const KNOWN_ARTIFACT_TYPES = [
  ...L2_ARTIFACT_TYPES,
  ...DEFERRED_ARTIFACT_TYPES,
  ...SYSTEM_ARTIFACT_TYPES,
] as const;

export const l2ArtifactTypeSchema = z.enum(L2_ARTIFACT_TYPES);
export const knownArtifactTypeSchema = z.enum(KNOWN_ARTIFACT_TYPES);
export type L2ArtifactType = z.infer<typeof l2ArtifactTypeSchema>;
export type KnownArtifactType = z.infer<typeof knownArtifactTypeSchema>;
