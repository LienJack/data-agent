import { FALCON24_AGENT_ANALYSIS_CASES } from "@data-agent/evals";
import { describe, expect, it } from "vitest";
import {
  falcon24AnalysisCaseResolverInternals,
  resolveFalcon24AnalysisCase,
} from "../../src/evals/falcon24-analysis-case-resolver.js";

function packageFor(caseId: (typeof FALCON24_AGENT_ANALYSIS_CASES)[number]["case_id"]) {
  const testCase = FALCON24_AGENT_ANALYSIS_CASES.find(({ case_id }) => case_id === caseId);
  if (!testCase) throw new TypeError("missing Falcon24 case fixture");
  const anchors = falcon24AnalysisCaseResolverInternals.case_anchors[caseId];
  return {
    semantic_domain: "falcon24",
    mandatory_closure: {
      object_ids: testCase.required_semantic_keys.filter(
        (key) => !key.startsWith("relationship.") && !key.startsWith("quality."),
      ),
      relationship_ids: testCase.required_semantic_keys.filter((key) =>
        key.startsWith("relationship."),
      ),
    },
    evidence: testCase.required_semantic_keys
      .filter((key) => key.startsWith("quality."))
      .map((evidence_id) => ({ evidence_id })),
    retrieval_receipt: {
      hits: anchors.map((object_id, index) => ({ object_id, rank: index + 1 })),
    },
  } as never;
}

describe("Falcon24 governed analysis case resolver", () => {
  it.each(FALCON24_AGENT_ANALYSIS_CASES)(
    "selects $case_id from semantic identities without reading question text",
    (testCase) => {
      expect(resolveFalcon24AnalysisCase(packageFor(testCase.case_id)).case_id).toBe(
        testCase.case_id,
      );
    },
  );

  it("rejects unsupported semantic domains", () => {
    const input = packageFor("falcon24-business-review-18m") as {
      semantic_domain: string;
    };
    input.semantic_domain = "other";
    expect(() => resolveFalcon24AnalysisCase(input as never)).toThrow(
      "GOVERNED_ANALYSIS_DOMAIN_UNSUPPORTED",
    );
  });

  it("fails closed when the frozen semantic closure has no unique registered program", () => {
    const input = packageFor("falcon24-business-review-18m") as {
      mandatory_closure: { object_ids: string[]; relationship_ids: string[] };
      evidence: unknown[];
      retrieval_receipt: { hits: unknown[] };
    };
    input.mandatory_closure.object_ids = [];
    input.mandatory_closure.relationship_ids = [];
    input.evidence = [];
    input.retrieval_receipt.hits = [];
    expect(() => resolveFalcon24AnalysisCase(input as never)).toThrow(
      "GOVERNED_ANALYSIS_SEMANTIC_PROGRAM_AMBIGUOUS",
    );
  });
});
