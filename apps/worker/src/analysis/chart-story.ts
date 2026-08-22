import {
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  sha256ContentHash,
} from "@data-agent/contracts";

export type AnalysisChartKind =
  | "LINE"
  | "HORIZONTAL_BAR"
  | "STACKED_BAR"
  | "SCATTER"
  | "HISTOGRAM"
  | "BOX"
  | "WATERFALL"
  | "HEATMAP";

export interface EvidenceFinding {
  readonly finding_id: string;
  readonly evidence_ref: ArtifactReference;
  readonly intent:
    | "TREND"
    | "RANKING"
    | "COMPOSITION"
    | "RELATIONSHIP"
    | "DISTRIBUTION"
    | "CONTRIBUTION"
    | "INTENSITY";
  readonly x_field: string;
  readonly y_field: string;
  readonly series_field: string | null;
  readonly observed_numbers: readonly number[];
  readonly accepted_statement: string;
  readonly score: number;
}

export interface EvidenceGroundedChartStory {
  readonly schema_version: "analysis-chart-story@1.0.0";
  readonly charts: readonly {
    readonly finding_id: string;
    readonly kind: AnalysisChartKind;
    readonly evidence_ref: ArtifactReference;
    readonly x_field: string;
    readonly y_field: string;
    readonly series_field: string | null;
    readonly expression: null;
  }[];
  readonly statements: readonly string[];
  readonly story_hash: `sha256:${string}`;
}

function chartKind(intent: EvidenceFinding["intent"]): AnalysisChartKind {
  switch (intent) {
    case "TREND":
      return "LINE";
    case "RANKING":
      return "HORIZONTAL_BAR";
    case "COMPOSITION":
      return "STACKED_BAR";
    case "RELATIONSHIP":
      return "SCATTER";
    case "DISTRIBUTION":
      return "HISTOGRAM";
    case "CONTRIBUTION":
      return "WATERFALL";
    case "INTENSITY":
      return "HEATMAP";
  }
}

function numericTokens(text: string): readonly string[] {
  return [...text.matchAll(/(?<![\p{L}\p{N}_])-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/gu)].map(
    ([token]) => token,
  );
}

function statementNumbersAreGrounded(finding: EvidenceFinding): boolean {
  const allowed = new Set(
    finding.observed_numbers.flatMap((value) => [
      String(value),
      value.toPrecision(15).replace(/0+$/u, "").replace(/\.$/u, ""),
    ]),
  );
  return numericTokens(finding.accepted_statement).every((token) => allowed.has(token));
}

export async function selectEvidenceGroundedChartStory(input: {
  readonly findings: readonly EvidenceFinding[];
  readonly max_charts: number;
  readonly scope: ArtifactReference;
}): Promise<EvidenceGroundedChartStory> {
  if (!Number.isInteger(input.max_charts) || input.max_charts < 1 || input.max_charts > 6) {
    throw new TypeError("ANALYSIS_CHART_BUDGET_INVALID");
  }
  const seenEvidence = new Set<string>();
  const selected = [...input.findings]
    .filter((finding) => {
      if (
        finding.evidence_ref.artifact_type !== "QueryEvidence" &&
        finding.evidence_ref.artifact_type !== "DerivedAnalysisEvidence"
      ) {
        return false;
      }
      if (
        finding.evidence_ref.app_id !== input.scope.app_id ||
        finding.evidence_ref.tenant_id !== input.scope.tenant_id ||
        finding.evidence_ref.environment !== input.scope.environment ||
        finding.evidence_ref.run_id !== input.scope.run_id ||
        !Number.isFinite(finding.score) ||
        finding.observed_numbers.some((value) => !Number.isFinite(value)) ||
        !statementNumbersAreGrounded(finding)
      ) {
        return false;
      }
      const identity = `${artifactReferenceIdentity(finding.evidence_ref)}\0${finding.intent}`;
      if (seenEvidence.has(identity)) return false;
      seenEvidence.add(identity);
      return true;
    })
    .sort(
      (left, right) => right.score - left.score || left.finding_id.localeCompare(right.finding_id),
    )
    .slice(0, input.max_charts);
  const material = {
    schema_version: "analysis-chart-story@1.0.0" as const,
    charts: selected.map((finding) => ({
      finding_id: finding.finding_id,
      kind: chartKind(finding.intent),
      evidence_ref: finding.evidence_ref,
      x_field: finding.x_field,
      y_field: finding.y_field,
      series_field: finding.series_field,
      expression: null,
    })),
    statements: selected.map(({ accepted_statement: statement }) => statement),
  };
  // Canonicalization is intentionally evaluated here as a preflight so this
  // projection cannot hide non-JSON values before hashing.
  canonicalizeJson(material);
  return Object.freeze({
    ...material,
    story_hash: await sha256ContentHash({
      hash_domain: "analysis-chart-story@1.0.0",
      value: material,
    }),
  });
}
