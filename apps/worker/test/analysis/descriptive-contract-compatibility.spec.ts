import { describe, expect, it } from "vitest";
import { compileCategoryComparisonPlan } from "../../src/analysis/category-comparison-planning.js";
import { compileMonthlyComparisonPlan } from "../../src/analysis/monthly-comparison-planning.js";
import { categoryComparisonFixture } from "./support/category-comparison-fixture.js";
import { monthlyComparisonFixture } from "./support/monthly-comparison-fixture.js";

// Captured from clean 23dcc9ad before extracting shared descriptive contract construction.
describe("existing descriptive ResultContract hash compatibility", () => {
  it("preserves the monthly multi-measure contract", async () => {
    const f = await monthlyComparisonFixture();
    expect(
      (
        await compileMonthlyComparisonPlan({
          context: f.context,
          query_evidence_ref: f.reference,
          query_evidence_document: f.document,
        })
      ).result_contract.contract_hash,
    ).toBe("sha256:eff1515c4f80aa4d7b586fcc9a4624d6713950d9938dff15fee80f93c0db95a0");
  });
  it.each([
    [false, false, "sha256:90f1a682ba3b65d301dd25e22bf29b42e1faf1c729dbbc9642ac60a1126ee00e"],
    [false, true, "sha256:2a7f54fe731b891c07db701dd04ff55878fe248a13c38928f15bcdf5eb50e9c6"],
    [true, false, "sha256:8c7779d93ab3c344545c9c8edb59cc34ba44ed97f712fd8ed2fc3e47644e03e1"],
    [true, true, "sha256:99cc8eb3f6122bfcca6fefc9fa4bc827180c020a9b3a3899b008b07889ee6689"],
  ] as const)("preserves category dimensions=%s derived=%s", async (two, derived, hash) => {
    const f = await categoryComparisonFixture(two, derived);
    expect(
      (
        await compileCategoryComparisonPlan({
          context: f.context,
          query_evidence_ref: f.reference,
          query_evidence_document: f.document,
        })
      ).result_contract.contract_hash,
    ).toBe(hash);
  });
});
