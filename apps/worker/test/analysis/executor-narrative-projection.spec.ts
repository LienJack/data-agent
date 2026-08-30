import { describe, expect, it } from "vitest";
import {
  buildAnalysisFinalMessages,
  buildAnalysisNarrativeProjection,
} from "../../src/analysis/executor.js";

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

  it("pins the final explanation to the exact two-field response contract", () => {
    const messages = buildAnalysisFinalMessages({
      stage_id: "stage-1",
      stage_hash: "sha256:stage",
      result_summary: { fields: { conclusion: "收入下降。" } },
      artifacts: [{ artifact_kind: "CHART" }],
      oracle_result: { verdict: "PASS" },
      limitation_codes: ["SEASONALITY_NOT_CORRECTED"],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content:
        'Return exactly one JSON object with only these two properties: {"schema_version":"analysis-agent-final@1.0.0","summary_zh":"..."}. Put all disclosed limitations inside summary_zh. The root property limitations and every other additional property are forbidden.',
    });
    expect(JSON.parse(messages[1]?.content ?? "null")).toMatchObject({
      kind: "ANALYSIS_STAGE_ORACLE_VERIFIED",
      limitation_codes: ["SEASONALITY_NOT_CORRECTED"],
      instruction: expect.stringContaining(
        "Return only schema_version and summary_zh; express every disclosed limitation inside summary_zh",
      ),
    });
  });
});
