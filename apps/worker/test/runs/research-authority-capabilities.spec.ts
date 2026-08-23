import { describe, expect, it } from "vitest";
import {
  createResearchAuthorityCapabilityResolver,
  parseResearchAuthorityCapabilityIds,
} from "../../src/runs/research-authority-capabilities.js";

const PURPOSES = [
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
  "REPORT_READ",
] as const;

function capabilitySet() {
  return Object.fromEntries(
    PURPOSES.map((purpose, index) => [
      purpose,
      `37000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ]),
  );
}

describe("Research Authority capability set", () => {
  it("requires a complete, purpose-separated capability set", () => {
    const parsed = parseResearchAuthorityCapabilityIds(JSON.stringify(capabilitySet()));
    expect(parsed).toEqual(capabilitySet());
    expect(parseResearchAuthorityCapabilityIds(undefined)).toBeNull();

    expect(() =>
      parseResearchAuthorityCapabilityIds(
        JSON.stringify({ ...capabilitySet(), EVIDENCE: capabilitySet().PLANNING }),
      ),
    ).toThrow("WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET_INVALID");
    expect(() =>
      parseResearchAuthorityCapabilityIds(
        JSON.stringify({ ...capabilitySet(), REPORT_READ: undefined }),
      ),
    ).toThrow("WORKER_RESEARCH_AUTHORITY_CAPABILITY_SET_INVALID");
  });

  it("routes every analysis artifact and historical read to its exact authority", () => {
    const ids = parseResearchAuthorityCapabilityIds(JSON.stringify(capabilitySet()));
    if (!ids) throw new Error("fixture missing");
    const appCapability = { authority: "app" };
    const resolver = createResearchAuthorityCapabilityResolver({
      app_capability: appCapability,
      capability_ids: ids,
    });

    expect(resolver.forArtifactType("ResearchBrief")).toEqual({
      app_capability: appCapability,
      authority_capability_id: ids.BRIEF_SEMANTIC,
    });
    expect(resolver.forArtifactType("AnalysisProgram").authority_capability_id).toBe(ids.PLANNING);
    expect(resolver.forArtifactType("QueryEvidence").authority_capability_id).toBe(ids.EVIDENCE);
    expect(resolver.forArtifactType("AnalysisCompletionReceipt").authority_capability_id).toBe(
      ids.COVERAGE,
    );
    expect(resolver.forDomain("REPORT_READ").authority_capability_id).toBe(ids.REPORT_READ);
    expect(() => resolver.forArtifactType("AnalysisPlan")).toThrow(
      "RESEARCH_ARTIFACT_AUTHORITY_DOMAIN_UNMAPPED:AnalysisPlan",
    );
  });
});
