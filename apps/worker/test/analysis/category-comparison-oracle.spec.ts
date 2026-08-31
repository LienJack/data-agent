import { createHash } from "node:crypto";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { describe, expect, it } from "vitest";
import { createCategoryComparisonOracle } from "../../src/analysis/category-comparison-oracle.js";
import {
  CATEGORY_COMPARISON_METHOD_ID,
  compileCategoryComparisonPlan,
} from "../../src/analysis/category-comparison-planning.js";
import {
  type AnalysisBoundOutput,
  type AnalysisOraclePort,
  buildAnalysisNarrativeProjection,
} from "../../src/analysis/executor.js";
import { projectStagedAnalysisChart } from "../../src/analysis/governed-analysis-runtime.js";
import { buildGovernedResultProjections } from "../../src/analysis/governed-result-projection.js";
import { productTeamGovernedQueryInternals } from "../../src/analysis/product-team-query-port.js";
import { productionGovernedAnalysisRuntimeInternals } from "../../src/analysis/production-governed-analysis-runtime.js";
import { categoryComparisonFixture } from "./support/category-comparison-fixture.js";
import { comparisonHash, comparisonRef } from "./support/monthly-comparison-fixture.js";

function output(
  name: string,
  kind: AnalysisBoundOutput["artifact_kind"],
  suffix: number,
  document: unknown,
): AnalysisBoundOutput {
  const content = new TextEncoder().encode(JSON.stringify(document));
  const content_sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
  return {
    artifact_name: name,
    artifact_kind: kind,
    media_type: "application/json",
    content,
    content_sha256,
    bytes: content.byteLength,
    reference: { ...comparisonRef("SandboxResult", suffix), content_hash: content_sha256 },
  };
}

async function fixture(two = false, derived = false) {
  const source = await categoryComparisonFixture(two, derived);
  if (source.document.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
  const plan = await compileCategoryComparisonPlan({
    context: source.context,
    query_evidence_ref: source.reference,
    query_evidence_document: source.document,
  });
  const contract = plan.result_contract;
  const group = (index: number) => {
    const names = ["Email", "App", "SMS", "Social"];
    return two
      ? { channel: names[Math.floor(index / 2)], audience: index % 2 === 0 ? "新客" : "老客" }
      : { channel: names[index] };
  };
  const point = (source_row_index: number, value: number) => ({
    source_row_index,
    group: group(source_row_index),
    value,
  });
  const delta = derived ? 1 : 0;
  const rank = (entries: number[][]) =>
    entries.map(([index, value]) => {
      if (index === undefined || value === undefined) throw new Error("TEST_POINT_REQUIRED");
      return point(index, value);
    });
  // Hand-calculated expected values; never call the production oracle to build its own expectation.
  const data = {
    observations: source.rows,
    claim_strength: "DESCRIPTIVE",
    measure_1: {
      source_column: "spend",
      observed_count: two ? 8 : 4,
      missing_count: 0,
      minimum: 0,
      maximum: 100,
      lowest: rank(
        two
          ? [
              [6, 0],
              [7, 0],
              [4, 50],
            ]
          : [
              [3, 0],
              [2, 50],
              [1, 80],
            ],
      ),
      highest: rank(
        two
          ? [
              [0, 100],
              [1, 100],
              [2, 80],
            ]
          : [
              [0, 100],
              [1, 80],
              [2, 50],
            ],
      ),
    },
    measure_2: {
      source_column: "revenue",
      observed_count: two ? 8 : 4,
      missing_count: 0,
      minimum: 0,
      maximum: 200,
      lowest: rank(
        two
          ? [
              [6, 0],
              [7, 0],
              [4, 100],
            ]
          : [
              [3, 0],
              [2, 100],
              [1, 120],
            ],
      ),
      highest: rank(
        two
          ? [
              [0, 200],
              [1, 200],
              [2, 120],
            ]
          : [
              [0, 200],
              [1, 120],
              [2, 100],
            ],
      ),
    },
    measure_3: {
      source_column: "return_rate",
      observed_count: two ? 6 : 3,
      missing_count: two ? 2 : 1,
      minimum: 1.5 - delta,
      maximum: 2 - delta,
      lowest: rank(
        two
          ? [
              [2, 1.5 - delta],
              [3, 1.5 - delta],
              [0, 2 - delta],
            ]
          : [
              [1, 1.5 - delta],
              [0, 2 - delta],
              [2, 2 - delta],
            ],
      ),
      highest: rank(
        two
          ? [
              [0, 2 - delta],
              [1, 2 - delta],
              [4, 2 - delta],
            ]
          : [
              [0, 2 - delta],
              [2, 2 - delta],
              [1, 1.5 - delta],
            ],
      ),
    },
  };
  const result = {
    schema_version: "analysis-published-result@1.0.0",
    contract_id: contract.contract_id,
    contract_hash: contract.contract_hash,
    semantic_context_hash: contract.semantic_context_hash,
    metrics: contract.metric_bindings,
    dimensions: contract.dimension_bindings,
    grain: contract.grain,
    lineage: contract.lineage,
    data,
  };
  const tableContract = contract.tables[0];
  const chartContract = contract.charts[0];
  if (!tableContract || !chartContract) throw new Error("TEST_CONTRACT_REQUIRED");
  const table = {
    schema_version: "analysis-published-table@1.0.0",
    table_id: tableContract.table_id,
    title_zh: tableContract.title_zh,
    columns: tableContract.columns,
    rows: source.rows,
    total_rows: source.rows.length,
  };
  const chart = {
    schema_version: "analysis-published-chart@1.0.0",
    chart_id: chartContract.chart_id,
    title_zh: chartContract.title_zh,
    intent: "COMPARISON",
    template_id: "bar.grouped@1",
    bindings: plan.execution_contract.chart_bindings,
    dataset: {
      table_id: tableContract.table_id,
      columns: tableContract.columns,
      rows: source.rows,
      total_rows: source.rows.length,
    },
  };
  const input: {
    -readonly [K in keyof Parameters<AnalysisOraclePort["evaluate"]>[0]]: Parameters<
      AnalysisOraclePort["evaluate"]
    >[0][K];
  } = {
    node: {
      node_id: "comparison",
      skill_id: "open-python-analysis@1",
      method_registry_entry_ids: [CATEGORY_COMPARISON_METHOD_ID],
      metric_refs: source.context.metrics.map((metric) => metric.metric_ref),
      dimension_refs: plan.shape.dimension_ids,
      time_window: null,
      comparison_window: null,
      parameters: {},
      execution_mode: "MODEL_GENERATED",
      generated_source_policy: "OPEN_ANALYSIS",
      operator_obligations: [],
      result_contract: contract,
      dependency_node_ids: [],
      activation_rule: { kind: "ALWAYS" },
      criticality: "CRITICAL",
    },
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
    sandbox_outputs: [
      output("result", "RESULT", 60, result),
      output(`table:${tableContract.table_id}`, "TABLE", 61, table),
      output(`chart:${chartContract.chart_id}`, "CHART", 62, chart),
    ],
    // Deliberate oracle-unit fixture; the executor separately verifies full materialization/sandbox receipts.
    sandbox_receipt: {
      result_contract_hash: contract.contract_hash,
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      operator_obligations: [],
      operator_receipts: [],
      operator_receipt_closure_hash: comparisonHash("f"),
    } as never,
  };
  return { source, plan, result, table, chart, input };
}

describe("independent category comparison oracle", () => {
  it("uses the matching production oracle and refuses a missing Host execution contract", async () => {
    const test = await fixture(true, true);
    const method = {
      method_id: CATEGORY_COMPARISON_METHOD_ID,
      skill_id: "open-python-analysis@1" as const,
      result_contract: test.plan.result_contract,
      required_operator_obligations: [],
      execution_contract: test.plan.execution_contract,
    };
    await expect(
      productionGovernedAnalysisRuntimeInternals
        .oracleForMethods(test.source.context, [method])
        .evaluate(test.input),
    ).resolves.toMatchObject({
      implementation_id: "category-multi-measure-comparison-oracle@1.0.0",
    });
    const contextInput = {
      question: "描述原数据",
      semantic_context_package: {} as never,
      context: test.source.context,
      binding: test.source.binding,
    };
    const loaded = await productionGovernedAnalysisRuntimeInternals
      .analysisContextPort({ ...contextInput, methods: [method] })
      .load({ node: test.input.node });
    expect(loaded.analysis_contract.semantic_contract.method_execution_contracts).toEqual([
      test.plan.execution_contract,
    ]);
    const { execution_contract: _rules, ...withoutRules } = method;
    await expect(
      productionGovernedAnalysisRuntimeInternals
        .analysisContextPort({ ...contextInput, methods: [withoutRules] })
        .load({ node: test.input.node }),
    ).rejects.toThrow("PRODUCTION_ANALYSIS_EXECUTION_CONTRACT_REQUIRED");
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("verifies source-bound groups and known values: two=%s derived=%s", async (two, derived) => {
    const test = await fixture(two, derived);
    const verdict = await createCategoryComparisonOracle(test.source.context).evaluate(test.input);
    expect(verdict).toMatchObject({
      result: {
        result_kind: "GENERATED_ANALYSIS",
        oracle_scope: "FULL",
        declared_method: CATEGORY_COMPARISON_METHOD_ID,
      },
      sample_size: two ? 8 : 4,
      coverage_ratio: 11 / 12,
      material_change: false,
      implementation_id: "category-multi-measure-comparison-oracle@1.0.0",
    });
    expect(verdict.implementation_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const projections = await buildGovernedResultProjections({
      contract: test.plan.result_contract,
      governed_inputs: test.input.governed_inputs,
    });
    expect(projections[0]?.table_rows).toEqual(test.source.rows);
    const chart = test.input.sandbox_outputs[2];
    if (!chart) throw new Error("TEST_CHART_REQUIRED");
    expect(projectStagedAnalysisChart(chart).projection).toMatchObject({
      chart_type: "BAR",
      x_key: "channel",
      y_keys: ["spend", "revenue", "return_rate"],
      series_key: two ? "audience" : null,
      table: { rows: test.source.rows, total_rows: two ? 8 : 4 },
    });
    expect(buildAnalysisNarrativeProjection(test.result).fields).toEqual({
      claim_strength: "DESCRIPTIVE",
      measure_1: test.result.data.measure_1,
      measure_2: test.result.data.measure_2,
      measure_3: test.result.data.measure_3,
    });
  });

  it.each([
    "value",
    "count",
    "tie-order",
    "group",
    "row-index",
    "extra-summary",
    "causal",
    "fill-null",
  ])("rejects a rehashed result mutation: %s", async (kind) => {
    const test = await fixture(true, true);
    const data = structuredClone(test.result.data);
    if (kind === "value") data.measure_1.maximum = 101;
    if (kind === "count") data.measure_3.missing_count = 0;
    if (kind === "tie-order") data.measure_3.highest.reverse();
    if (kind === "group")
      Reflect.deleteProperty(data.measure_3.highest[0]?.group ?? {}, "audience");
    if (kind === "row-index") {
      const point = data.measure_3.highest[0];
      if (point) point.source_row_index = 7;
    }
    if (kind === "extra-summary") Object.assign(data, { summary_zh: "投入导致收入增长" });
    if (kind === "causal") data.claim_strength = "CAUSAL";
    if (kind === "fill-null")
      data.observations = data.observations.map((row) => ({
        ...row,
        return_rate: row.return_rate ?? 0,
      }));
    test.input.sandbox_outputs = [
      output("result", "RESULT", 60, { ...test.result, data }),
      ...test.input.sandbox_outputs.slice(1),
    ];
    await expect(
      createCategoryComparisonOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow("CATEGORY_COMPARISON_ORACLE_RESULT_MISMATCH");
  });

  it.each([
    "table-order",
    "table-value",
    "table-role",
    "chart-series",
    "chart-value",
    "chart-y",
    "chart-title",
  ])("rejects rehashed table/chart drift: %s", async (kind) => {
    const test = await fixture(true);
    const table = structuredClone(test.table),
      chart = structuredClone(test.chart);
    if (kind === "table-order") table.rows.reverse();
    if (kind === "table-value") {
      const row = table.rows[0];
      if (row) row.spend = 999;
    }
    if (kind === "table-role") {
      const column = table.columns.at(-1);
      if (column) column.semantic_role = "METRIC";
    }
    if (kind === "chart-series") chart.bindings.series_field = null;
    if (kind === "chart-value") {
      const row = chart.dataset.rows[0];
      if (row) row.spend = 999;
    }
    if (kind === "chart-y") chart.bindings.y_fields = ["revenue"];
    if (kind === "chart-title") chart.title_zh = "已证明因果关系";
    test.input.sandbox_outputs = [
      test.input.sandbox_outputs[0] ?? output("result", "RESULT", 60, test.result),
      output(`table:${table.table_id}`, "TABLE", 61, table),
      output(`chart:${chart.chart_id}`, "CHART", 62, chart),
    ];
    await expect(
      createCategoryComparisonOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow(
      kind.startsWith("table")
        ? "CATEGORY_COMPARISON_ORACLE_TABLE_MISMATCH"
        : "CATEGORY_COMPARISON_ORACLE_CHART_MISMATCH",
    );
  });

  it.each([
    "method",
    "metric",
    "dimension",
    "window",
    "contract",
    "operator",
    "arrow",
    "output-hash",
    "output-run",
  ])("rejects source/closure drift: %s", async (kind) => {
    const test = await fixture();
    if (kind === "method") test.input.node.method_registry_entry_ids = ["other@1"];
    if (kind === "metric") test.input.node.metric_refs = [];
    if (kind === "dimension") test.input.node.dimension_refs = [];
    if (kind === "window")
      test.input.node.time_window = {
        start: "2024-01-01T00:00:00Z",
        end: "2025-01-01T00:00:00Z",
        timezone: "UTC",
        semantics: "HALF_OPEN",
      };
    if (kind === "contract")
      test.input.node.result_contract = {
        ...test.input.node.result_contract,
        contract_hash: comparisonHash("f"),
      };
    if (kind === "operator")
      test.input.sandbox_receipt = {
        ...test.input.sandbox_receipt,
        operator_registry_digest: comparisonHash("f"),
      };
    if (kind === "arrow") {
      const first = test.input.governed_inputs[0];
      if (!first) throw new Error("TEST_INPUT_REQUIRED");
      test.input.governed_inputs = [{ ...first, content: new Uint8Array([1, 2, 3]) }];
    }
    if (kind === "output-hash")
      test.input.sandbox_outputs = test.input.sandbox_outputs.map((item, index) =>
        index === 0 ? { ...item, content_sha256: comparisonHash("f") } : item,
      );
    if (kind === "output-run")
      test.input.sandbox_outputs = test.input.sandbox_outputs.map((item, index) =>
        index === 0
          ? {
              ...item,
              reference: {
                ...item.reference,
                run_id: comparisonRef("SandboxResult", 999).artifact_id,
              },
            }
          : item,
      );
    await expect(
      createCategoryComparisonOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow(/CATEGORY_COMPARISON_ORACLE_|ANALYSIS_INPUT_/);
  });

  it("rejects structurally valid Arrow that replaces an undefined ratio with zero", async () => {
    const test = await fixture();
    if (test.source.document.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
    const content = productTeamGovernedQueryInternals.materializeProductTeamArrow(
      {
        ...test.source.document.projection,
        rows: test.source.document.projection.rows.map((row) => ({
          ...row,
          return_rate: row.return_rate ?? 0,
        })),
      },
      test.source.binding.columns,
    );
    const first = test.input.governed_inputs[0];
    if (!first) throw new Error("TEST_INPUT_REQUIRED");
    test.input.governed_inputs = [{ ...first, content }];
    await expect(
      createCategoryComparisonOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow("ANALYSIS_INPUT_ARROW_CONTENT_MISMATCH");
  });
});
