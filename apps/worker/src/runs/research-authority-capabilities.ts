import { z } from "zod";

export const researchArtifactAuthorityDomainSchema = z.enum([
  "BRIEF_SEMANTIC",
  "PLANNING",
  "OBLIGATION_EXECUTION",
  "EVIDENCE",
  "CLAIM_STRUCTURE",
  "RELATION",
  "PROOF",
  "COVERAGE",
  "RESEARCH_STOP",
  "PROJECTION",
  "EVIDENCE_GATE",
  "READINESS",
]);

export type ResearchArtifactAuthorityDomain = z.infer<typeof researchArtifactAuthorityDomainSchema>;
export type ResearchAuthorityCapabilityPurpose = ResearchArtifactAuthorityDomain | "REPORT_READ";

export const researchAuthorityCapabilityIdsSchema = z
  .strictObject({
    BRIEF_SEMANTIC: z.uuid(),
    PLANNING: z.uuid(),
    OBLIGATION_EXECUTION: z.uuid(),
    EVIDENCE: z.uuid(),
    CLAIM_STRUCTURE: z.uuid(),
    RELATION: z.uuid(),
    PROOF: z.uuid(),
    COVERAGE: z.uuid(),
    RESEARCH_STOP: z.uuid(),
    PROJECTION: z.uuid(),
    EVIDENCE_GATE: z.uuid(),
    READINESS: z.uuid(),
    REPORT_READ: z.uuid(),
  })
  .superRefine((value, context) => {
    if (new Set(Object.values(value)).size !== Object.keys(value).length) {
      context.addIssue({
        code: "custom",
        message: "每个 Research Authority purpose 必须使用互异的 Capability ID。",
      });
    }
  });

export type ResearchAuthorityCapabilityIds = z.infer<typeof researchAuthorityCapabilityIdsSchema>;

export interface ResearchAuthorityCapabilityInput {
  readonly app_capability: unknown;
  readonly authority_capability_id: string;
}

export interface ResearchAuthorityCapabilityResolver {
  forDomain(domain: ResearchAuthorityCapabilityPurpose): ResearchAuthorityCapabilityInput;
  forArtifactType(artifactType: string): ResearchAuthorityCapabilityInput;
}

const ARTIFACT_DOMAIN = Object.freeze({
  ResearchBrief: "BRIEF_SEMANTIC",
  HypothesisSet: "PLANNING",
  EvidencePlan: "PLANNING",
  AnalysisProgram: "PLANNING",
  SandboxProgram: "PLANNING",
  ObligationExecutionDecision: "OBLIGATION_EXECUTION",
  QueryEvidence: "EVIDENCE",
  DataProfile: "EVIDENCE",
  DerivedAnalysisEvidence: "EVIDENCE",
  AnalysisInputMaterializationReceipt: "EVIDENCE",
  SandboxExecutionReceipt: "EVIDENCE",
  SandboxResult: "EVIDENCE",
  AtomicClaim: "CLAIM_STRUCTURE",
  EvidenceRelation: "RELATION",
  EvidenceCheckReceipt: "PROOF",
  SupportDecision: "PROOF",
  HypothesisAssessment: "PROOF",
  CoverageState: "COVERAGE",
  AnalysisCompletionReceipt: "COVERAGE",
  ResearchStopDecision: "RESEARCH_STOP",
  ReportManifest: "PROJECTION",
  AnalysisReport: "PROJECTION",
  ReportProjectionReceipt: "PROJECTION",
  EvidenceGateReceipt: "EVIDENCE_GATE",
  ReportReadyCertificate: "READINESS",
} satisfies Readonly<Record<string, ResearchArtifactAuthorityDomain>>);

export function parseResearchAuthorityCapabilityIds(
  source: string | undefined,
): ResearchAuthorityCapabilityIds | null {
  const normalized = source?.trim();
  if (!normalized) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(normalized);
  } catch {
    throw new TypeError("WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET_INVALID");
  }
  const parsed = researchAuthorityCapabilityIdsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TypeError("WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET_INVALID");
  }
  return Object.freeze(parsed.data);
}

export function createResearchAuthorityCapabilityResolver(input: {
  readonly app_capability: unknown;
  readonly capability_ids: ResearchAuthorityCapabilityIds;
}): ResearchAuthorityCapabilityResolver {
  const forDomain = (domain: ResearchAuthorityCapabilityPurpose) =>
    Object.freeze({
      app_capability: input.app_capability,
      authority_capability_id: input.capability_ids[domain],
    });
  return Object.freeze({
    forDomain,
    forArtifactType(artifactType: string) {
      const domain = ARTIFACT_DOMAIN[artifactType as keyof typeof ARTIFACT_DOMAIN];
      if (!domain)
        throw new TypeError(`RESEARCH_ARTIFACT_AUTHORITY_DOMAIN_UNMAPPED:${artifactType}`);
      return forDomain(domain);
    },
  });
}

export const researchAuthorityCapabilityInternals = Object.freeze({ ARTIFACT_DOMAIN });
