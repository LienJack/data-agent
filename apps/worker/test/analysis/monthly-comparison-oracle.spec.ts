import { createHash } from "node:crypto";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { describe, expect, it } from "vitest";
import type { AnalysisBoundOutput, AnalysisOraclePort } from "../../src/analysis/executor.js";
import { buildAnalysisNarrativeProjection } from "../../src/analysis/executor.js";
import {
  createMonthlyComparisonOracle,
  monthlyComparisonOracleInternals,
} from "../../src/analysis/monthly-comparison-oracle.js";
import {
  compileMonthlyComparisonPlan,
  MONTHLY_COMPARISON_METHOD_ID,
} from "../../src/analysis/monthly-comparison-planning.js";
import { productTeamGovernedQueryInternals } from "../../src/analysis/product-team-query-port.js";
import { productionGovernedAnalysisRuntimeInternals } from "../../src/analysis/production-governed-analysis-runtime.js";
import {
  comparisonHash,
  comparisonRef,
  monthlyComparisonFixture,
} from "./support/monthly-comparison-fixture.js";

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
const period = (month: number) => `2024-${String(month).padStart(2, "0")}-01`;
const point = (month: number, value: number) => ({ period: period(month), value });

async function fixture() {
  const source = await monthlyComparisonFixture();
  if (source.document.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
  const plan = await compileMonthlyComparisonPlan({
    context: source.context,
    query_evidence_ref: source.reference,
    query_evidence_document: source.document,
  });
  const contract = plan.result_contract;
  const common = { first_period: period(1), last_period: period(12) };
  const data = {
    observations: source.rows,
    claim_strength: "DESCRIPTIVE",
    measure_1: {
      ...common,
      source_column: "current",
      observed_count: 12,
      missing_count: 0,
      minimum: 0,
      maximum: 140,
      lowest: [point(7, 0), point(5, 80), point(8, 90)],
      highest: [point(12, 140), point(2, 130), point(11, 130)],
      first_value: 120,
      last_value: 140,
      absolute_change: 20,
      relative_change: 20 / 120,
      largest_drops: [
        {
          from_period: period(6),
          to_period: period(7),
          absolute_change: -110,
          relative_change: -1,
        },
        {
          from_period: period(2),
          to_period: period(3),
          absolute_change: -30,
          relative_change: -30 / 130,
        },
        {
          from_period: period(4),
          to_period: period(5),
          absolute_change: -20,
          relative_change: -0.2,
        },
      ],
    },
    measure_2: {
      ...common,
      source_column: "prior",
      observed_count: 6,
      missing_count: 6,
      minimum: 100,
      maximum: 100,
      lowest: [point(7, 100), point(8, 100), point(9, 100)],
      highest: [point(7, 100), point(8, 100), point(9, 100)],
      first_value: null,
      last_value: 100,
      absolute_change: null,
      relative_change: null,
      largest_drops: [],
    },
    measure_3: {
      ...common,
      source_column: "rate",
      observed_count: 6,
      missing_count: 6,
      minimum: -1,
      maximum: 0.4,
      lowest: [point(7, -1), point(8, -0.1), point(9, 0)],
      highest: [point(12, 0.4), point(11, 0.3), point(9, 0)],
      first_value: null,
      last_value: 0.4,
      absolute_change: null,
      relative_change: null,
      largest_drops: [],
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
    total_rows: 12,
  };
  const chart = {
    schema_version: "analysis-published-chart@1.0.0",
    chart_id: chartContract.chart_id,
    title_zh: chartContract.title_zh,
    intent: "TREND",
    template_id: "line.multi-series@1",
    bindings: {
      x_field: "month",
      y_fields: ["current", "prior", "rate"],
      series_field: null,
      lower_bound_field: null,
      upper_bound_field: null,
    },
    dataset: {
      table_id: tableContract.table_id,
      columns: tableContract.columns,
      rows: source.rows,
      total_rows: 12,
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
      method_registry_entry_ids: [MONTHLY_COMPARISON_METHOD_ID],
      metric_refs: source.context.metrics.map((metric) => metric.metric_ref),
      dimension_refs: ["dimension.month"],
      time_window: {
        start: "2024-01-01T00:00:00.000+08:00",
        end: "2025-01-01T00:00:00.000+08:00",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
      comparison_window: null,
      parameters: { declared_method: "open-python-analysis@1" },
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

describe("independent monthly comparison oracle", () => {
  it("reaches the independent oracle through the production registry and retains bounded narrative facts", async () => {
    const test = await fixture();
    const methods = [
      {
        method_id: MONTHLY_COMPARISON_METHOD_ID,
        skill_id: "open-python-analysis@1" as const,
        result_contract: test.plan.result_contract,
        required_operator_obligations: [],
        execution_contract: test.plan.execution_contract,
      },
    ];
    const oracle = productionGovernedAnalysisRuntimeInternals.oracleForMethods(
      test.source.context,
      methods,
    );
    await expect(oracle.evaluate(test.input)).resolves.toMatchObject({
      implementation_id: "monthly-multi-measure-comparison-oracle@1.0.0",
    });
    const summary = buildAnalysisNarrativeProjection(test.result);
    expect(summary.fields).toEqual({
      claim_strength: "DESCRIPTIVE",
      measure_1: test.result.data.measure_1,
      measure_2: test.result.data.measure_2,
      measure_3: test.result.data.measure_3,
    });
    expect(summary.collection_counts).toEqual({ observations: 12 });
    await expect(
      productionGovernedAnalysisRuntimeInternals
        .oracleForMethods(test.source.context, [])
        .evaluate(test.input),
    ).rejects.toThrow("PRODUCTION_ANALYSIS_METHOD_BINDING_INVALID");
    await expect(
      productionGovernedAnalysisRuntimeInternals
        .oracleForMethods(test.source.context, methods)
        .evaluate({ ...test.input, node: { ...test.input.node, skill_id: "trend-change@1" } }),
    ).rejects.toThrow("PRODUCTION_ANALYSIS_METHOD_BINDING_INVALID");
  });

  it("keeps an original zero endpoint and undefined relative change", async () => {
    const test = await fixture();
    const changed = {
      ...test.plan,
      shape: {
        ...test.plan.shape,
        ordered_rows: test.plan.shape.ordered_rows.map((row, index) =>
          index === 0 ? { ...row, current: 0 } : row,
        ),
      },
    };
    expect(monthlyComparisonOracleInternals.expectedMeasure(changed, "current")).toMatchObject({
      first_value: 0,
      last_value: 140,
      absolute_change: 140,
      relative_change: null,
      lowest: [point(1, 0), point(7, 0), point(5, 80)],
    });
  });

  it("never interprets two observed months around a missing month as adjacent", async () => {
    const test = await fixture();
    const changed = {
      ...test.plan,
      shape: {
        ...test.plan.shape,
        ordered_rows: test.plan.shape.ordered_rows.map((row, index) =>
          index === 4 ? { ...row, current: null } : index === 5 ? { ...row, current: 50 } : row,
        ),
      },
    };
    expect(monthlyComparisonOracleInternals.expectedMeasure(changed, "current")).toMatchObject({
      observed_count: 11,
      missing_count: 1,
      largest_drops: [
        { from_period: period(6), to_period: period(7), absolute_change: -50, relative_change: -1 },
        {
          from_period: period(2),
          to_period: period(3),
          absolute_change: -30,
          relative_change: -30 / 130,
        },
      ],
    });
  });

  it("fails closed when finite inputs overflow a derived numeric value", async () => {
    const test = await fixture();
    const changed = {
      ...test.plan,
      shape: {
        ...test.plan.shape,
        ordered_rows: test.plan.shape.ordered_rows.map((row, index) =>
          index === 0
            ? { ...row, current: Number.MAX_VALUE }
            : index === 11
              ? { ...row, current: -Number.MAX_VALUE }
              : row,
        ),
      },
    };
    expect(() => monthlyComparisonOracleInternals.expectedMeasure(changed, "current")).toThrow(
      "MONTHLY_COMPARISON_ORACLE_NUMERIC_RANGE_INVALID",
    );
  });

  it("rejects a type-correct Arrow whose NULL values were filled", async () => {
    const test = await fixture();
    if (test.source.document.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
    const changed = productTeamGovernedQueryInternals.materializeProductTeamArrow(
      {
        ...test.source.document.projection,
        rows: test.source.rows.map((row) => ({ ...row, rate: row.rate ?? 0 })),
      },
      test.source.binding.columns,
    );
    await expect(
      createMonthlyComparisonOracle(test.source.context).evaluate({
        ...test.input,
        governed_inputs: test.input.governed_inputs.map((item) => ({ ...item, content: changed })),
      }),
    ).rejects.toThrow("ANALYSIS_INPUT_ARROW_CONTENT_MISMATCH");
  });

  it("recomputes descriptive results from the exact Arrow/source and retains undefined endpoints", async () => {
    const test = await fixture();
    const verdict = await createMonthlyComparisonOracle(test.source.context).evaluate(test.input);
    expect(verdict).toMatchObject({
      sample_size: 12,
      coverage_ratio: 2 / 3,
      material_change: false,
      result: {
        result_kind: "GENERATED_ANALYSIS",
        declared_method: MONTHLY_COMPARISON_METHOD_ID,
        oracle_scope: "FULL",
        structured_output_refs: test.input.sandbox_outputs.map((item) => item.reference),
      },
    });
    expect(verdict.limitation_codes).toContain("RELATIVE_DELTA_UNDEFINED");
  });

  it.each([
    "minimum",
    "count",
    "tie-order",
    "source-column",
    "first-null",
    "bridge-gap",
    "rounding",
    "unverified-summary",
    "causal-claim",
  ])("rejects rehashed %s result", async (mutation) => {
    const test = await fixture();
    const result = structuredClone(test.result);
    if (mutation === "minimum") result.data.measure_1.minimum = -1;
    if (mutation === "count") result.data.measure_2.observed_count = 12;
    if (mutation === "tie-order") result.data.measure_2.highest.reverse();
    if (mutation === "source-column") result.data.measure_1.source_column = "prior";
    if (mutation === "first-null") Object.assign(result.data.measure_2, { first_value: 100 });
    if (mutation === "bridge-gap")
      Object.assign(result.data.measure_3, {
        largest_drops: [
          {
            from_period: period(1),
            to_period: period(7),
            absolute_change: -1,
            relative_change: -1,
          },
        ],
      });
    if (mutation === "rounding") result.data.measure_1.relative_change = 0.167;
    if (mutation === "unverified-summary")
      Object.assign(result.data, { summary_zh: "未验证的结论" });
    if (mutation === "causal-claim") result.data.claim_strength = "CAUSAL";
    test.input.sandbox_outputs = [
      output("result", "RESULT", 60, result),
      ...test.input.sandbox_outputs.slice(1),
    ];
    await expect(
      createMonthlyComparisonOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow("MONTHLY_COMPARISON_ORACLE_RESULT_MISMATCH");
  });

  it.each([
    "table-value",
    "table-role",
    "chart-value",
    "chart-y",
    "chart-series",
    "chart-title",
    "table-reorder",
    "zero-fill",
  ])("rejects rehashed %s projection", async (mutation) => {
    const test = await fixture();
    const table = structuredClone(test.table);
    const chart = structuredClone(test.chart);
    if (mutation === "table-value")
      table.rows = table.rows.map((row, index) => (index === 0 ? { ...row, current: 121 } : row));
    if (mutation === "table-role")
      table.columns = table.columns.map((column) =>
        column.key === "rate" ? { ...column, semantic_role: "METRIC" } : column,
      );
    if (mutation === "chart-value")
      chart.dataset.rows = chart.dataset.rows.map((row, index) =>
        index === 0 ? { ...row, current: 121 } : row,
      );
    if (mutation === "chart-y") chart.bindings.y_fields.pop();
    if (mutation === "chart-series") Object.assign(chart.bindings, { series_field: "prior" });
    if (mutation === "chart-title") chart.title_zh = "因果结论";
    if (mutation === "table-reorder") table.rows.reverse();
    if (mutation === "zero-fill")
      chart.dataset.rows = chart.dataset.rows.map((row) => ({ ...row, rate: row.rate ?? 0 }));
    const first = test.input.sandbox_outputs[0];
    if (!first) throw new Error("TEST_RESULT_REQUIRED");
    test.input.sandbox_outputs = [
      first,
      output(`table:${table.table_id}`, "TABLE", 61, table),
      output(`chart:${chart.chart_id}`, "CHART", 62, chart),
    ];
    await expect(
      createMonthlyComparisonOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow(/MONTHLY_COMPARISON_ORACLE_(TABLE|CHART)_MISMATCH/);
  });

  it.each([
    "method",
    "contract",
    "window",
    "metric",
    "operators",
    "arrow",
    "input-count",
    "output-count",
    "output-hash",
    "output-run",
  ])("rejects %s closure drift", async (mutation) => {
    const test = await fixture();
    const input = structuredClone(test.input);
    if (mutation === "method") input.node.method_registry_entry_ids = ["unknown@1"];
    if (mutation === "contract") input.node.result_contract.contract_hash = comparisonHash("0");
    if (mutation === "window") input.node.time_window.end = "2025-02-01T00:00:00.000+08:00";
    if (mutation === "metric") input.node.metric_refs = [];
    if (mutation === "operators") input.sandbox_receipt.operator_receipts = [{}] as never;
    if (mutation === "arrow") {
      const content = input.governed_inputs[0]?.content;
      if (content) content.fill(0);
    }
    if (mutation === "input-count") input.governed_inputs = [];
    if (mutation === "output-count") input.sandbox_outputs = input.sandbox_outputs.slice(0, 2);
    if (mutation === "output-hash")
      input.sandbox_outputs = input.sandbox_outputs.map((item, index) =>
        index === 0 ? { ...item, content_sha256: comparisonHash("0") } : item,
      );
    if (mutation === "output-run")
      input.sandbox_outputs = input.sandbox_outputs.map((item, index) =>
        index === 0
          ? {
              ...item,
              reference: {
                ...item.reference,
                run_id: comparisonRef("SandboxResult", 70).artifact_id,
              },
            }
          : item,
      );
    await expect(
      createMonthlyComparisonOracle(test.source.context).evaluate(input),
    ).rejects.toThrow(/MONTHLY_COMPARISON_|ANALYSIS_INPUT_/);
  });
});
