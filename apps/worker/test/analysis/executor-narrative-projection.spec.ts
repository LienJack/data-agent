import { describe, expect, it } from "vitest";
import { buildAnalysisNarrativeProjection } from "../../src/analysis/executor.js";

describe("analysis executor narrative projection", () => {
  it("keeps bounded verified findings while leaving full rows and method evidence in artifacts", () => {
    const projection = buildAnalysisNarrativeProjection({
      schema_version: "analysis-published-result@1.0.0",
      data: {
        schema_version: "falcon24-inventory-output@1.0.0",
        case_id: "falcon24-inventory-damage-12m",
        conclusion: "完整结论。",
        products: Array.from({ length: 4_000 }, (_, index) => ({ product_id: `${index}` })),
        method_evidence: { coefficients: Array.from({ length: 4_000 }, () => 1) },
      },
    });

    expect(projection).toEqual({
      schema_version: "analysis-narrative-projection@1.0.0",
      fields: {
        schema_version: "falcon24-inventory-output@1.0.0",
        case_id: "falcon24-inventory-damage-12m",
        conclusion: "完整结论。",
      },
      collection_counts: { products: 4_000 },
      omitted_authority_fields: ["method_evidence"],
    });
    expect(JSON.stringify(projection).length).toBeLessThan(24 * 1024);
  });
});
