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
});
