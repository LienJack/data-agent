import type { ArtifactReference } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  type AcceptedInsightClaim,
  type InsightCandidate,
  selectEvidenceGroundedInsights,
} from "../../src/analysis-evidence/insight-selector.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
function ref(artifact_type: ArtifactReference["artifact_type"], suffix: number): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    app_id: id(1),
    tenant_id: id(2),
    environment: "test",
    run_id: id(3),
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  };
}

const claim: AcceptedInsightClaim = {
  claim_ref: ref("AtomicClaim", 4),
  evidence_ref: ref("DerivedAnalysisEvidence", 5),
  claim_mode: "COMPARATIVE",
  statement: "广州订单从 10 增至 12",
  numbers: [10, 12],
  entities: ["广州", "订单"],
  identification_certificate_ref: null,
};

function candidate(overrides: Partial<InsightCandidate> = {}): InsightCandidate {
  return {
    finding_id: "finding-1",
    tier: "FACT",
    statement: claim.statement,
    source_claim_refs: [claim.claim_ref],
    numbers: [10, 12],
    entities: ["广州", "订单"],
    published_playbook_ref: null,
    score: 1,
    ...overrides,
  };
}

describe("evidence-grounded insight selector", () => {
  it("selects and bounds only exact accepted statements deterministically", () => {
    const findings = selectEvidenceGroundedInsights({
      accepted_claims: [claim],
      candidates: [
        candidate({ finding_id: "b", score: 1 }),
        candidate({ finding_id: "a", score: 2 }),
        candidate({ finding_id: "duplicate", score: 0 }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      finding_id: "a",
      status: "ACCEPTED",
      evidence_level: "L2_OBSERVATION",
    });
  });

  it("rejects invented numbers, entities, causes, and ungoverned recommendations", () => {
    const findings = selectEvidenceGroundedInsights({
      accepted_claims: [claim],
      candidates: [
        candidate({ finding_id: "number", statement: "广州订单从 10 增至 99", numbers: [10, 99] }),
        candidate({
          finding_id: "entity",
          statement: "深圳订单从 10 增至 12",
          entities: ["深圳", "订单"],
        }),
        candidate({ finding_id: "cause", statement: "广州订单因促销从 10 增至 12" }),
        candidate({ finding_id: "action", tier: "RECOMMENDATION_CANDIDATE" }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("labels discovery as L4 and certificate-bound estimates as L5", () => {
    const l4: AcceptedInsightClaim = {
      ...claim,
      claim_ref: ref("AtomicClaim", 6),
      evidence_ref: ref("DiscoveryCandidate", 7),
      claim_mode: "ROOT_CAUSE_CANDIDATE",
    };
    const l5: AcceptedInsightClaim = {
      ...claim,
      claim_ref: ref("AtomicClaim", 8),
      evidence_ref: ref("CausalEstimate", 9),
      claim_mode: "CAUSAL_ESTIMATE",
      statement: "广州订单认证效应为 12",
      numbers: [12],
      identification_certificate_ref: ref("IdentificationCertificate", 10),
    };
    expect(
      selectEvidenceGroundedInsights({
        accepted_claims: [l4, l5],
        candidates: [
          candidate({
            finding_id: "l4",
            tier: "DRIVER",
            source_claim_refs: [l4.claim_ref],
            score: 2,
          }),
          candidate({
            finding_id: "l5",
            tier: "DRIVER",
            statement: l5.statement,
            source_claim_refs: [l5.claim_ref],
            numbers: [12],
            score: 1,
          }),
        ],
      }).map(({ evidence_level, disclosure_codes }) => ({ evidence_level, disclosure_codes })),
    ).toEqual([
      {
        evidence_level: "L4_DISCOVERY",
        disclosure_codes: [
          "STATISTICAL_ASSOCIATION_NOT_CAUSATION",
          "ROOT_CAUSE_CANDIDATE_NOT_CERTIFIED",
        ],
      },
      {
        evidence_level: "L5_CERTIFIED",
        disclosure_codes: ["CAUSAL_ESTIMATE_ASSUMPTION_BOUND"],
      },
    ]);
  });
});
