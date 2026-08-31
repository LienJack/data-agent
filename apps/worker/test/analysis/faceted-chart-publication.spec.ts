import { createHash } from "node:crypto";
import { canonicalizeJson } from "@data-agent/contracts/common";
import { describe, expect, it } from "vitest";
import { compileCategoryComparisonPlan } from "../../src/analysis/category-comparison-planning.js";
import { projectStagedAnalysisChart } from "../../src/analysis/governed-analysis-runtime.js";
import { buildGovernedResultProjections } from "../../src/analysis/governed-result-projection.js";
import { productTeamGovernedQueryInternals } from "../../src/analysis/product-team-query-port.js";
import {
  type AnalysisExtractedSymbols,
  prepareAnalysisResult,
} from "../../src/analysis/result-publisher.js";
import { categoryComparisonFixture } from "./support/category-comparison-fixture.js";
import { comparisonRef } from "./support/monthly-comparison-fixture.js";

async function fixture(facet = true) {
  const source = await categoryComparisonFixture(true, true);
  if (source.document.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
  const plan = await compileCategoryComparisonPlan({
    context: source.context,
    query_evidence_ref: source.reference,
    query_evidence_document: source.document,
  });
  const table = plan.result_contract.tables[0],
    chart = plan.result_contract.charts[0];
  if (!table || !chart) throw new Error("TEST_CONTRACT_REQUIRED");
  const projections = await buildGovernedResultProjections({
    contract: plan.result_contract,
    governed_inputs: [
      {
        name: "query_evidence",
        format: "ARROW",
        query_evidence_ref: source.reference,
        query_evidence_document: source.document,
        input_ref: comparisonRef("SensitiveExecutionArtifact", 50),
        materialization_receipt_ref: comparisonRef("AnalysisInputMaterializationReceipt", 51),
        materialization_receipt_document: {},
        content: productTeamGovernedQueryInternals.materializeProductTeamArrow(
          source.document.projection,
          source.binding.columns,
        ),
      },
    ],
  });
  // Publisher component fixture only: no oracle, Sandbox receipt, atomic commit or production method PASS.
  // DIRECT observations are extracted from the verified source, not these model symbols.
  const extraction: AnalysisExtractedSymbols = {
    schema_version: "analysis-extracted-symbols@1.0.0",
    symbols: [
      {
        symbol_name: "result_document",
        symbol_kind: "MAPPING",
        value: {
          kind: "OBJECT",
          entries: [
            { key: "observations", value: { kind: "ARRAY", items: [] } },
            ...plan.execution_contract.measure_fields.map(({ field }) => ({
              key: field,
              value: { kind: "OBJECT" as const, entries: [] },
            })),
            { key: "claim_strength", value: { kind: "STRING", value: "DESCRIPTIVE" } },
          ],
        },
      },
      {
        symbol_name: "comparison_table",
        symbol_kind: "TABLE",
        columns: table.columns.map(({ key }) => key),
        rows: [],
      },
    ],
  };
  const input = {
    contract: plan.result_contract,
    manifest: {
      schema_version: facet
        ? "analysis-result-publish-tool@1.1.0"
        : "analysis-result-publish-tool@1.0.0",
      publish_id: "comparison",
      result_symbol: "result_document",
      table_bindings: [{ table_id: table.table_id, data_symbol: "comparison_table" }],
      operator_bindings: [],
      chart_bindings: [
        {
          chart_id: chart.chart_id,
          intent: chart.intent,
          template_id: "bar.grouped@1",
          data_symbol: "comparison_table",
          x_field: "channel",
          y_fields: ["spend", "revenue", "return_rate"],
          series_field: "",
          lower_bound_field: "",
          upper_bound_field: "",
          ...(facet ? { facet_field: "audience" } : {}),
        },
      ],
    },
    governed_operator_outputs: [],
    governed_result_projections: projections,
    extractor: { extract: async () => extraction },
  };
  return { source, input };
}

describe("source facet publisher and read-back", () => {
  it("preserves actual Arrow rows and NULL through the original publisher and V3 projection", async () => {
    const test = await fixture();
    const prepared = await prepareAnalysisResult(test.input);
    const chart = prepared.closure.artifacts.find((artifact) => artifact.artifact_kind === "CHART");
    if (!chart) throw new Error("TEST_CHART_REQUIRED");
    expect(JSON.parse(new TextDecoder().decode(chart.content))).toMatchObject({
      schema_version: "analysis-published-chart@1.1.0",
      bindings: { facet_field: "audience", series_field: null },
      dataset: { rows: test.source.rows, total_rows: 8 },
    });
    expect(chart.content_sha256).toBe(
      `sha256:${createHash("sha256").update(chart.content).digest("hex")}`,
    );
    expect(projectStagedAnalysisChart(chart).projection).toMatchObject({
      facet_key: "audience",
      series_key: null,
      table: { rows: test.source.rows, total_rows: 8 },
    });
    const old = await fixture(false);
    const previous = await prepareAnalysisResult(old.input);
    expect(
      previous.closure.artifacts.filter((artifact) => artifact.artifact_kind !== "CHART"),
    ).toEqual(prepared.closure.artifacts.filter((artifact) => artifact.artifact_kind !== "CHART"));
    const oldChart = previous.closure.artifacts.find(
      (artifact) => artifact.artifact_kind === "CHART",
    );
    if (!oldChart) throw new Error("TEST_CHART_REQUIRED");
    const oldDocument = JSON.parse(new TextDecoder().decode(oldChart.content));
    expect(oldDocument.schema_version).toBe("analysis-published-chart@1.0.0");
    expect(oldDocument.bindings).not.toHaveProperty("facet_field");
    expect(projectStagedAnalysisChart(oldChart).projection).not.toHaveProperty("facet_key");
    expect(previous.closure.manifest_hash).not.toBe(prepared.closure.manifest_hash);
    expect(previous.closure.closure_hash).not.toBe(prepared.closure.closure_hash);
  });

  it.each(["missing", "spend"])(
    "rejects a facet without an original categorical source: %s",
    async (facet_field) => {
      const test = await fixture();
      test.input.manifest.chart_bindings = test.input.manifest.chart_bindings.map((binding) => ({
        ...binding,
        y_fields: ["revenue"],
        facet_field,
      }));
      await expect(prepareAnalysisResult(test.input)).rejects.toThrow(
        "ANALYSIS_RESULT_CHART_FIELD_BINDING_INVALID",
      );
    },
  );

  it.each(["legacy-facet", "new-without-facet"])(
    "rejects re-sealed published chart version confusion: %s",
    async (kind) => {
      const test = await fixture();
      const prepared = await prepareAnalysisResult(test.input);
      const chart = prepared.closure.artifacts.find(
        (artifact) => artifact.artifact_kind === "CHART",
      );
      if (!chart) throw new Error("TEST_CHART_REQUIRED");
      const document = JSON.parse(new TextDecoder().decode(chart.content));
      if (kind === "legacy-facet") document.schema_version = "analysis-published-chart@1.0.0";
      else delete document.bindings.facet_field;
      const content = new TextEncoder().encode(canonicalizeJson(document));
      expect(() =>
        projectStagedAnalysisChart({
          ...chart,
          content,
          bytes: content.byteLength,
          content_sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        }),
      ).toThrow("ANALYSIS_CHART_FACET_VERSION_INVALID");
    },
  );
});
