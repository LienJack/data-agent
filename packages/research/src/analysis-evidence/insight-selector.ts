import { type ArtifactReference, artifactReferenceIdentity } from "@data-agent/contracts";

export type InsightTier =
  | "FACT"
  | "PATTERN"
  | "DRIVER"
  | "INTERPRETATION"
  | "RECOMMENDATION_CANDIDATE";

export interface AcceptedInsightClaim {
  readonly claim_ref: ArtifactReference;
  readonly evidence_ref: ArtifactReference;
  readonly claim_mode:
    | "DESCRIPTIVE"
    | "COMPARATIVE"
    | "DIAGNOSTIC"
    | "QUALITY"
    | "ASSOCIATIVE"
    | "ROOT_CAUSE_CANDIDATE"
    | "CAUSAL_ESTIMATE"
    | "PREDICTIVE";
  readonly statement: string;
  readonly numbers: readonly number[];
  readonly entities: readonly string[];
  readonly identification_certificate_ref: ArtifactReference | null;
}

export interface InsightCandidate {
  readonly finding_id: string;
  readonly tier: InsightTier;
  readonly statement: string;
  readonly source_claim_refs: readonly ArtifactReference[];
  readonly numbers: readonly number[];
  readonly entities: readonly string[];
  readonly published_playbook_ref: ArtifactReference | null;
  readonly score: number;
}

export interface SelectedInsight {
  readonly finding_id: string;
  readonly tier: InsightTier;
  readonly statement: string;
  readonly evidence_ref: ArtifactReference;
  readonly evidence_level: "L2_OBSERVATION" | "L4_DISCOVERY" | "L5_CERTIFIED";
  readonly status: "ACCEPTED" | "CANDIDATE";
  readonly disclosure_codes: readonly string[];
}

function statementNumbers(statement: string) {
  return [...statement.matchAll(/-?\d+(?:\.\d+)?/gu)].map(([value]) => Number(value));
}

function includesNumber(values: readonly number[], candidate: number) {
  return values.some((value) => Object.is(value, candidate) || Math.abs(value - candidate) < 1e-12);
}

function level(claims: readonly AcceptedInsightClaim[]) {
  if (
    claims.some(
      ({ claim_mode, identification_certificate_ref }) =>
        claim_mode === "CAUSAL_ESTIMATE" && identification_certificate_ref !== null,
    )
  ) {
    return "L5_CERTIFIED" as const;
  }
  if (claims.some(({ claim_mode }) => claim_mode === "ROOT_CAUSE_CANDIDATE")) {
    return "L4_DISCOVERY" as const;
  }
  return "L2_OBSERVATION" as const;
}

export function selectEvidenceGroundedInsights(input: {
  readonly accepted_claims: readonly AcceptedInsightClaim[];
  readonly candidates: readonly InsightCandidate[];
  readonly maximum_findings?: number;
}): readonly SelectedInsight[] {
  const maximum = Math.min(16, Math.max(1, input.maximum_findings ?? 8));
  const claims = new Map(
    input.accepted_claims.map((claim) => [artifactReferenceIdentity(claim.claim_ref), claim]),
  );
  const selected = input.candidates
    .flatMap((candidate): SelectedInsight[] => {
      const sources = candidate.source_claim_refs.map((reference) =>
        claims.get(artifactReferenceIdentity(reference)),
      );
      if (
        sources.length === 0 ||
        sources.some((claim) => !claim) ||
        !Number.isFinite(candidate.score)
      ) {
        return [];
      }
      const accepted = sources.filter((claim): claim is AcceptedInsightClaim => Boolean(claim));
      const allowedNumbers = accepted.flatMap(({ numbers }) => numbers);
      const allowedEntities = new Set(accepted.flatMap(({ entities }) => entities));
      if (
        !accepted.some(({ statement }) => statement === candidate.statement) ||
        candidate.numbers.some((value) => !includesNumber(allowedNumbers, value)) ||
        statementNumbers(candidate.statement).some(
          (value) => !includesNumber(candidate.numbers, value),
        ) ||
        candidate.entities.some((entity) => !allowedEntities.has(entity))
      ) {
        return [];
      }
      if (
        candidate.tier === "RECOMMENDATION_CANDIDATE" &&
        candidate.published_playbook_ref === null
      ) {
        return [];
      }
      const evidenceLevel = level(accepted);
      if (
        candidate.tier === "DRIVER" &&
        !accepted.some(({ claim_mode }) =>
          ["DIAGNOSTIC", "ROOT_CAUSE_CANDIDATE", "CAUSAL_ESTIMATE"].includes(claim_mode),
        )
      ) {
        return [];
      }
      if (
        evidenceLevel === "L5_CERTIFIED" &&
        accepted.some(
          ({ claim_mode, identification_certificate_ref }) =>
            claim_mode === "CAUSAL_ESTIMATE" && identification_certificate_ref === null,
        )
      ) {
        return [];
      }
      return [
        {
          finding_id: candidate.finding_id,
          tier: candidate.tier,
          statement: candidate.statement,
          evidence_ref: accepted[0]?.evidence_ref as ArtifactReference,
          evidence_level: evidenceLevel,
          status: candidate.tier === "RECOMMENDATION_CANDIDATE" ? "CANDIDATE" : "ACCEPTED",
          disclosure_codes:
            evidenceLevel === "L4_DISCOVERY"
              ? ["STATISTICAL_ASSOCIATION_NOT_CAUSATION", "ROOT_CAUSE_CANDIDATE_NOT_CERTIFIED"]
              : evidenceLevel === "L5_CERTIFIED"
                ? ["CAUSAL_ESTIMATE_ASSUMPTION_BOUND"]
                : [],
        },
      ];
    })
    .sort((left, right) => {
      const leftCandidate = input.candidates.find(
        ({ finding_id }) => finding_id === left.finding_id,
      );
      const rightCandidate = input.candidates.find(
        ({ finding_id }) => finding_id === right.finding_id,
      );
      return (
        (rightCandidate?.score ?? 0) - (leftCandidate?.score ?? 0) ||
        left.finding_id.localeCompare(right.finding_id)
      );
    });
  const perTier = new Map<InsightTier, number>();
  const statements = new Set<string>();
  return Object.freeze(
    selected.filter((finding) => {
      if ([...perTier.values()].reduce((sum, value) => sum + value, 0) >= maximum) return false;
      if (statements.has(finding.statement)) return false;
      const count = perTier.get(finding.tier) ?? 0;
      if (count >= 2) return false;
      perTier.set(finding.tier, count + 1);
      statements.add(finding.statement);
      return true;
    }),
  );
}
