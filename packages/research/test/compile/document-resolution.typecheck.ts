import type {
  L2ArtifactPayloadFor,
  ResearchPayloadFor,
  ResolvedL2ArtifactDocumentCandidate,
  ResolvedResearchDocumentCandidate,
} from "../../src/internal/document-resolution.js";

type Assignable<Target, Source extends Target> = Source;
type QueryEvidenceResolution = ResolvedResearchDocumentCandidate<"QueryEvidence">;
type AtomicClaimResolution = ResolvedResearchDocumentCandidate<"AtomicClaim">;
type QueryEvidencePayload = ResearchPayloadFor<"QueryEvidence">;
type AtomicClaimPayload = ResearchPayloadFor<"AtomicClaim">;
type QueryContractResolution = ResolvedL2ArtifactDocumentCandidate<"QueryContract">;
type SqlArtifactResolution = ResolvedL2ArtifactDocumentCandidate<"SqlArtifact">;
type QueryContractPayload = L2ArtifactPayloadFor<"QueryContract">;
type SqlArtifactPayload = L2ArtifactPayloadFor<"SqlArtifact">;

export type QueryEvidenceResolutionAcceptsItsOwnArtifactType = Assignable<
  QueryEvidenceResolution,
  QueryEvidenceResolution
>;

export type QueryEvidenceResolutionCannotBecomeAtomicClaim = Assignable<
  AtomicClaimResolution,
  // @ts-expect-error QueryEvidence resolution 不能冒充 AtomicClaim resolution。
  QueryEvidenceResolution
>;

export type QueryEvidencePayloadAcceptsItsOwnArtifactType = Assignable<
  QueryEvidencePayload,
  QueryEvidencePayload
>;

export type QueryEvidencePayloadCannotBecomeAtomicClaim = Assignable<
  AtomicClaimPayload,
  // @ts-expect-error QueryEvidence payload 的 artifact_type 不能收窄为 AtomicClaim。
  QueryEvidencePayload
>;

export type QueryContractResolutionAcceptsItsOwnArtifactType = Assignable<
  QueryContractResolution,
  QueryContractResolution
>;

export type QueryContractResolutionCannotBecomeSqlArtifact = Assignable<
  SqlArtifactResolution,
  // @ts-expect-error QueryContract resolution 不能冒充 SqlArtifact resolution。
  QueryContractResolution
>;

export type QueryContractPayloadAcceptsItsOwnArtifactType = Assignable<
  QueryContractPayload,
  QueryContractPayload
>;

export type QueryContractPayloadCannotBecomeSqlArtifact = Assignable<
  SqlArtifactPayload,
  // @ts-expect-error QueryContract payload 的 artifact_type 不能收窄为 SqlArtifact。
  QueryContractPayload
>;
