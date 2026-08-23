import { FALCON24_AGENT_ANALYSIS_CASES } from "@data-agent/evals";
import { describe, expect, it } from "vitest";
import { directQaAnalysisInternals } from "../../src/teams/direct-qa-analysis-executor.js";

describe("direct Q&A analysis", () => {
  it.each([
    ["表之间的关联是如何", true],
    ["这些实体怎么连接", true],
    ["解释一下这个概念", false],
  ] as const)("routes %s without Root/Specialist", (question, expected) => {
    expect(directQaAnalysisInternals.asksForRelationships(question)).toBe(expected);
  });

  it.each(FALCON24_AGENT_ANALYSIS_CASES)(
    "routes $case_id to the governed AnalysisProgram path",
    (testCase) => {
      expect(directQaAnalysisInternals.falcon24CaseFor(` ${testCase.question}。 `)?.case_id).toBe(
        testCase.case_id,
      );
      expect(directQaAnalysisInternals.routeFor(testCase.question)).toBe("FALCON24_ANALYSIS");
    },
  );

  it("classifies the cohort question before its relationship wording", () => {
    const cohort = FALCON24_AGENT_ANALYSIS_CASES.find(
      ({ case_id: caseId }) => caseId === "falcon24-cohort-retention-m0-m6",
    );
    expect(cohort).toBeDefined();
    expect(directQaAnalysisInternals.asksForRelationships(cohort?.question ?? "")).toBe(true);
    expect(directQaAnalysisInternals.falcon24CaseFor(cohort?.question ?? "")?.case_id).toBe(
      "falcon24-cohort-retention-m0-m6",
    );
    expect(directQaAnalysisInternals.routeFor(cohort?.question ?? "")).toBe("FALCON24_ANALYSIS");
  });
});
