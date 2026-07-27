import type { L2ArtifactType } from "../types.js";

export const L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES = [
  "ResearchBrief",
  "HypothesisSet",
  "EvidencePlan",
  "QueryEvidence",
  "AtomicClaim",
  "EvidenceRelation",
  "AnalysisReport",
  "ReportReadyCertificate",
] as const satisfies readonly L2ArtifactType[];

const historicalOnlyArtifactTypes = new Set<L2ArtifactType>(
  L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES,
);

export function isHistoricalOnlyL2ResearchArtifactType(
  artifactType: L2ArtifactType,
): artifactType is (typeof L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES)[number] {
  return historicalOnlyArtifactTypes.has(artifactType);
}

export class L2ResearchWireError extends Error {
  override readonly name = "L2ResearchWireError";
  readonly retryable = false;

  constructor(
    readonly code:
      | "L2_WIRE_VERSION_WRITE_UNSUPPORTED"
      | "L2_WIRE_REFERENCE_CLOSURE_INVALID"
      | "L2_WIRE_ARTIFACT_TOO_LARGE",
    message: string,
  ) {
    super(message);
  }
}
