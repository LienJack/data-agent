import type {
  SemanticBindingImpactSafeProjection,
  SemanticExplorerCandidateComparison,
} from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateComparisonBand } from "@/components/semantic/explorer/candidate-comparison-band";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const impact: SemanticBindingImpactSafeProjection = {
  schema_version: "semantic-binding-impact-safe-projection@1.0.0",
  impact_id: id(1),
  receipt_hash: hash("1"),
  plan_hash: hash("2"),
  drift_event_id: id(2),
  release: { release_id: id(3), generation: 4, release_digest: hash("3") },
  status: "REVIEW_REQUIRED",
  risk_level: "HIGH",
  direct_impact_count: 2,
  transitive_impact_count: 5,
  suggested_actions: ["REVIEW_MAPPING", "REVALIDATE_FORMULA"],
  manual_reason_codes: [],
  candidate_ref: {
    candidate_id: id(4),
    revision_id: id(5),
    source_revision_id: id(6),
    source_digest: hash("4"),
    revision_digest: hash("5"),
  },
  committed_at: "2026-08-23T08:00:00.000Z",
};

const comparison = {
  schema_version: "semantic-explorer-candidate-comparison@1.0.0",
  semantic_domain: "commerce",
  candidate_id: id(4),
  revision_id: id(5),
  revision_number: 1,
  source_revision_id: id(6),
  candidate_status: "DRAFT",
  base_release: null,
  compared_release: null,
  comparison_state: { state: "candidate", reason_code: null },
  diff: { summary: "2 个绑定待复核", operations: [] },
} as unknown as SemanticExplorerCandidateComparison;

describe("semantic binding impact comparison band", () => {
  it("shows only safe counts, exact release and draft governance state", () => {
    const markup = renderToStaticMarkup(
      <CandidateComparisonBand impact={impact} comparison={comparison} />,
    );
    expect(markup).toContain("HIGH");
    expect(markup).toMatch(/直接影响[\s\S]*>2<\/dd>/u);
    expect(markup).toMatch(/传递影响[\s\S]*>5<\/dd>/u);
    expect(markup).toContain(impact.release.release_id);
    expect(markup).toContain("DRAFT");
    expect(markup).not.toMatch(/package_json|drift_payload|raw_sql|rows|dsn|provider_payload/i);
  });
});
