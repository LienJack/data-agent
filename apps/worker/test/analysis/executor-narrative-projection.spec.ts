import { describe, expect, it } from "vitest";
import {
  buildAnalysisFinalMessages,
  buildAnalysisNarrativeProjection,
} from "../../src/analysis/executor.js";

describe("analysis executor narrative projection", () => {
  it("keeps the complete bounded monthly observation series with its exact calendar/value pairs", () => {
    const observations = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(Date.UTC(2023, 10 + i, 1)).toISOString().slice(0, 10),
      current: 100 + i,
      prior: i < 6 ? null : 100,
      growth: i < 6 ? null : [-0.05, 0.067, 0.0096, -0.124, -0.092, -0.07][i - 6],
    }));
    const result = {
      schema_version: "analysis-published-result@1.0.0",
      contract_id: "monthly-multi-measure-comparison.result",
      data: { observations, claim_strength: "DESCRIPTIVE" },
    };
    const projection = buildAnalysisNarrativeProjection(result);
    expect(projection.fields.observations).toEqual(observations);
    expect(projection.collection_counts).toEqual({ observations: 12 });
    expect(
      observations
        .filter((r) => r.growth !== null && r.growth !== undefined && r.growth > 0)
        .map((r) => r.month),
    ).toEqual(["2024-06-01", "2024-07-01"]);
    expect(
      buildAnalysisNarrativeProjection({ ...result, contract_id: "other.result" }).fields
        .observations,
    ).toBeUndefined();
    expect(
      buildAnalysisNarrativeProjection({
        ...result,
        data: { observations: [...observations, observations[0]] },
      }).fields.observations,
    ).toBeUndefined();
    expect(
      buildAnalysisNarrativeProjection({
        ...result,
        data: { observations: observations.map((r) => ({ ...r, extra: "x".repeat(8192) })) },
      }).fields.observations,
    ).toBeUndefined();
  });

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
      objective: "解释订单收入同比，不是每个辅助序列的全部统计量。",
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
      objective: "解释订单收入同比，不是每个辅助序列的全部统计量。",
      limitation_codes: ["SEASONALITY_NOT_CORRECTED"],
      instruction: expect.stringContaining(
        "Return only schema_version and summary_zh; express every disclosed limitation inside summary_zh",
      ),
    });
    expect(messages[0]?.content).toContain("Answer the objective");
    expect(messages[0]?.content).toContain("not evidence");
    expect(messages[0]?.content).toContain("Do not enumerate every auxiliary series statistic");
    expect(messages[0]?.content).toContain(
      "Generic largest_drops describes adjacent-month changes",
    );
    expect(messages[0]?.content).toContain("TOTAL_YOY_RATE across BOTH_PERIOD_GROUPS");
    expect(messages[0]?.content).toContain("percentage points, not a percent share of the loss");
    expect(messages[0]?.content).toContain("If period_comparison is absent or omitted");
    expect(messages[0]?.content).toContain("Ranked highest/lowest points are not chronological");
    expect(messages[0]?.content).toContain("negative YoY is not a monotonically falling YoY rate");
  });

  it("keeps asymmetric null endpoints and zero denominators explicit in final-stage evidence", () => {
    const measures = {
      missing_start: {
        first_value: null,
        last_value: 20,
        absolute_change: null,
        relative_change: null,
      },
      missing_end: {
        first_value: 10,
        last_value: null,
        absolute_change: null,
        relative_change: null,
      },
      zero_start: { first_value: 0, last_value: 20, absolute_change: 20, relative_change: null },
    };
    const messages = buildAnalysisFinalMessages({
      objective: "解释可观察的变化和缺失限制。",
      stage_id: "stage-1",
      stage_hash: "sha256:stage",
      result_summary: buildAnalysisNarrativeProjection({ data: measures }),
      artifacts: [],
      oracle_result: { verdict: "PASS" },
      limitation_codes: ["RELATIVE_DELTA_UNDEFINED"],
      metric_units: [],
    });
    expect(JSON.parse(messages[1]?.content ?? "null").result_summary.fields).toEqual(measures);
    expect(messages[0]?.content).toContain("A null change does not imply both endpoints are null");
    expect(messages[0]?.content).toContain("zero is an observed value, not missing");
    expect(messages[0]?.content).toContain("RELATIVE_DELTA_UNDEFINED is a result-level limitation");
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
        objective: "说明订单收入趋势。",
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
