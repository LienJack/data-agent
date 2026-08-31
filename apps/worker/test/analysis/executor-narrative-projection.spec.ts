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
      metric_units: [],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining(
        'Return exactly one JSON object with only these two properties: {"schema_version":"analysis-agent-final@1.0.0","summary_zh":"..."}. Put all disclosed limitations inside summary_zh. The root property limitations and every other additional property are forbidden.',
      ),
    });
    expect(JSON.parse(messages[1]?.content ?? "null")).toMatchObject({
      kind: "ANALYSIS_STAGE_ORACLE_VERIFIED",
      limitation_codes: ["SEASONALITY_NOT_CORRECTED"],
      instruction: expect.stringContaining(
        "Return only schema_version and summary_zh; express every disclosed limitation inside summary_zh",
      ),
    });
  });

  it.each([
    null,
    {
      unit_id: "unit.currency",
      description: "Monetary amount in the datasource currency.",
      dimension: "currency" as const,
      base_unit: null,
      conversion_factor: null,
    },
    {
      unit_id: "unit.inr",
      description: "Indian rupees.",
      dimension: "currency" as const,
      base_unit: "INR",
      conversion_factor: 1,
    },
  ])(
    "carries the published unit to the final explanation without inferring currency: %j",
    (unit) => {
      const metric = {
        metric_ref: {
          container_ref: {
            artifact_type: "SemanticRelease" as const,
            artifact_id: "00000000-0000-4000-8000-000000000001",
            app_id: "00000000-0000-4000-8000-000000000002",
            tenant_id: "00000000-0000-4000-8000-000000000003",
            environment: "test" as const,
            run_id: "00000000-0000-4000-8000-000000000004",
            revision: 1,
            content_hash: `sha256:${"a".repeat(64)}` as const,
          },
          node_id: "metric.order_revenue",
        },
        unit,
      };
      const messages = buildAnalysisFinalMessages({
        stage_id: "stage-1",
        stage_hash: "sha256:stage",
        result_summary: { fields: { start_value: 567783.74, end_value: 537702.94 } },
        artifacts: [{ artifact_kind: "CHART" }],
        oracle_result: { verdict: "PASS" },
        limitation_codes: [],
        metric_units: [metric],
      });

      expect(JSON.parse(messages[1]?.content ?? "null").metric_units).toEqual([metric]);
      expect(messages[0]?.content).toContain(
        "A generic currency unit does not identify a currency",
      );
      expect(messages[0]?.content).toContain("Never infer a currency from the response language");
      expect(messages[0]?.content).toContain("disclose that the specific currency is unspecified");
    },
  );
});
