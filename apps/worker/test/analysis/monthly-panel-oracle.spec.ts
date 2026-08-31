import { createHash } from "node:crypto";
import { buildProductTeamArtifactDocument } from "@data-agent/contracts/artifacts";
import { analysisSandboxExecutionReceiptSchema } from "@data-agent/contracts/ports";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { describe, expect, it } from "vitest";
import { resolveAnalysisEvidenceTimeWindow } from "../../src/analysis/analysis-evidence-time-window.js";
import {
  type AnalysisBoundOutput,
  type AnalysisOraclePort,
  buildAnalysisNarrativeProjection,
} from "../../src/analysis/executor.js";
import { projectStagedAnalysisChart } from "../../src/analysis/governed-analysis-runtime.js";
import { buildGovernedResultProjections } from "../../src/analysis/governed-result-projection.js";
import {
  createMonthlyPanelOracle,
  monthlyPanelOracleInternals,
} from "../../src/analysis/monthly-panel-oracle.js";
import {
  compileMonthlyPanelPlan,
  MONTHLY_PANEL_METHOD_ID,
} from "../../src/analysis/monthly-panel-planning.js";
import { productTeamGovernedQueryInternals } from "../../src/analysis/product-team-query-port.js";
import { productionGovernedAnalysisRuntimeInternals } from "../../src/analysis/production-governed-analysis-runtime.js";
import {
  comparisonHash,
  comparisonId,
  comparisonRef,
} from "./support/monthly-comparison-fixture.js";
import { monthlyPanelFixture, monthlyPeriodPanelFixture } from "./support/monthly-panel-fixture.js";

function output(
  name: string,
  kind: AnalysisBoundOutput["artifact_kind"],
  suffix: number,
  document: unknown,
): AnalysisBoundOutput {
  const content = new TextEncoder().encode(JSON.stringify(document));
  const hash = `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
  return {
    artifact_name: name,
    artifact_kind: kind,
    media_type: "application/json",
    content,
    content_sha256: hash,
    bytes: content.byteLength,
    reference: { ...comparisonRef("SandboxResult", suffix), content_hash: hash },
  };
}
const period = (month: number) => `2024-${String(month).padStart(2, "0")}-01`;
const point = (month: number, value: number) => ({ period: period(month), value });
type OracleInput = {
  -readonly [K in keyof Parameters<AnalysisOraclePort["evaluate"]>[0]]: Parameters<
    AnalysisOraclePort["evaluate"]
  >[0][K];
};

async function fixture(two = true, derived = true, yoy = false) {
  const source = yoy ? await monthlyPeriodPanelFixture() : await monthlyPanelFixture(two, derived);
  const revenueLast = yoy ? 10 : 20;
  const rateLast = yoy ? -0.5 : derived ? 0 : 1;
  const rateFirst = derived ? 3 : 4;
  const rateDelta = rateLast - rateFirst;
  const draft = structuredClone(source.document);
  if (draft.projection.kind !== "TABLE" || draft.provenance?.kind !== "GOVERNED_QUERY_RESULT")
    throw new Error("TEST_QUERY_REQUIRED");
  // Deliberately simple hand-calculated input: one zero-denominator month and opposite endpoint changes.
  draft.projection.rows = draft.projection.rows.map((row) => {
    const factor = (row.channel === "Email" ? 1 : 3) + (row.audience === "老客" ? 1 : 0);
    const missing = row.month === period(3);
    const last = row.month === period(12);
    return {
      ...row,
      spend: (missing ? 0 : last ? 20 : 10) * factor,
      revenue: (missing ? 0 : last ? revenueLast : 40) * factor,
      return_rate: missing ? null : last ? rateLast : rateFirst,
    };
  });
  const document = await buildProductTeamArtifactDocument(draft);
  if (
    document.artifact_ref.artifact_type !== "QueryEvidence" ||
    document.projection.kind !== "TABLE"
  )
    throw new Error("TEST_QUERY_REQUIRED");
  const plan = await compileMonthlyPanelPlan({
    context: source.context,
    query_evidence_ref: document.artifact_ref,
    query_evidence_document: document,
  });
  const groups = [
    { group: { channel: "Email", ...(two ? { audience: "新客" } : {}) }, factor: 1 },
    ...(two ? [{ group: { channel: "Email", audience: "老客" }, factor: 2 }] : []),
    { group: { channel: "App", ...(two ? { audience: "新客" } : {}) }, factor: 3 },
    ...(two ? [{ group: { channel: "App", audience: "老客" }, factor: 4 }] : []),
  ];
  const common = {
    observed_count: 12,
    missing_count: 0,
    first_period: period(1),
    last_period: period(12),
  };
  // These expected ranks/changes are fixed, not obtained from the oracle or a second copy of its algorithm.
  const rawData = {
    observations: structuredClone(document.projection.rows),
    claim_strength: "DESCRIPTIVE",
    measure_1: groups.map(({ group, factor: f }) => ({
      ...common,
      group,
      source_column: "spend",
      minimum: 0,
      maximum: 20 * f,
      lowest: [point(3, 0), point(1, 10 * f), point(2, 10 * f)],
      highest: [point(12, 20 * f), point(1, 10 * f), point(2, 10 * f)],
      first_value: 10 * f,
      last_value: 20 * f,
      absolute_change: 10 * f,
      relative_change: 1,
      largest_drops: [
        {
          from_period: period(2),
          to_period: period(3),
          absolute_change: -10 * f,
          relative_change: -1,
        },
      ],
    })),
    measure_2: groups.map(({ group, factor: f }) => ({
      ...common,
      group,
      source_column: "revenue",
      minimum: 0,
      maximum: 40 * f,
      lowest: [point(3, 0), point(12, revenueLast * f), point(1, 40 * f)],
      highest: [point(1, 40 * f), point(2, 40 * f), point(4, 40 * f)],
      first_value: 40 * f,
      last_value: revenueLast * f,
      absolute_change: (revenueLast - 40) * f,
      relative_change: (revenueLast - 40) / 40,
      largest_drops: [
        {
          from_period: period(2),
          to_period: period(3),
          absolute_change: -40 * f,
          relative_change: -1,
        },
        {
          from_period: period(11),
          to_period: period(12),
          absolute_change: (revenueLast - 40) * f,
          relative_change: (revenueLast - 40) / 40,
        },
      ],
    })),
    measure_3: groups.map(({ group }) => ({
      ...common,
      group,
      source_column: "return_rate",
      observed_count: 11,
      missing_count: 1,
      minimum: rateLast,
      maximum: rateFirst,
      lowest: [point(12, rateLast), point(1, rateFirst), point(2, rateFirst)],
      highest: [point(1, rateFirst), point(2, rateFirst), point(4, rateFirst)],
      first_value: rateFirst,
      last_value: rateLast,
      absolute_change: rateDelta,
      relative_change: rateDelta / rateFirst,
      largest_drops: [
        {
          from_period: period(11),
          to_period: period(12),
          absolute_change: rateDelta,
          relative_change: rateDelta / rateFirst,
        },
      ],
    })),
    opposed_changes: groups.flatMap(({ group, factor: f }) => [
      {
        group,
        increasing_column: "spend",
        decreasing_column: "revenue",
        from_period: period(1),
        to_period: period(12),
        increasing_absolute_change: 10 * f,
        decreasing_absolute_change: (revenueLast - 40) * f,
        increasing_relative_change: 1,
        decreasing_relative_change: (revenueLast - 40) / 40,
      },
      {
        group,
        increasing_column: "spend",
        decreasing_column: "return_rate",
        from_period: period(1),
        to_period: period(12),
        increasing_absolute_change: 10 * f,
        decreasing_absolute_change: rateDelta,
        increasing_relative_change: 1,
        decreasing_relative_change: rateDelta / rateFirst,
      },
    ]),
  };
  const data = {
    ...rawData,
    measure_1: { groups: rawData.measure_1 },
    measure_2: { groups: rawData.measure_2 },
    measure_3: { groups: rawData.measure_3 },
    opposed_changes: { pairs: rawData.opposed_changes },
    ...(yoy
      ? {
          period_comparison: {
            comparison_kind: "YEAR_OVER_YEAR",
            group_coverage: "BOTH_PERIOD_GROUPS",
            ranking_basis: "TOTAL_YOY_RATE",
            months: Array.from({ length: 12 }, (_, i) => ({
              period: period(i + 1),
              current_value: i === 2 ? 0 : i === 11 ? 40 : 160,
              comparison_value: i === 2 ? 0 : i === 11 ? 80 : 40,
              absolute_change: i === 2 ? 0 : i === 11 ? -40 : 120,
              yoy_rate: i === 2 ? null : i === 11 ? -0.5 : 3,
              ranking_eligible: i !== 2,
            })),
            largest_declines: [
              {
                period: period(12),
                current_value: 40,
                comparison_value: 80,
                absolute_change: -40,
                yoy_rate: -0.5,
                ranking_eligible: true,
                groups: [
                  {
                    group: { channel: "Email" },
                    current_value: 10,
                    comparison_value: 20,
                    absolute_change: -10,
                    yoy_rate: -0.5,
                    contribution_to_total_growth: -0.125,
                  },
                  {
                    group: { channel: "App" },
                    current_value: 30,
                    comparison_value: 60,
                    absolute_change: -30,
                    yoy_rate: -0.5,
                    contribution_to_total_growth: -0.375,
                  },
                ],
              },
            ],
          },
        }
      : {}),
  };
  const contract = plan.result_contract;
  const tableContract = contract.tables[0];
  const chartContract = contract.charts[0];
  if (!tableContract || !chartContract) throw new Error("TEST_CONTRACT_REQUIRED");
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
  const table = {
    schema_version: "analysis-published-table@1.0.0",
    table_id: tableContract.table_id,
    title_zh: tableContract.title_zh,
    columns: tableContract.columns,
    rows: data.observations,
    total_rows: data.observations.length,
  };
  const chart = {
    schema_version: two ? "analysis-published-chart@1.1.0" : "analysis-published-chart@1.0.0",
    chart_id: chartContract.chart_id,
    title_zh: chartContract.title_zh,
    intent: "TREND",
    template_id: "line.multi-series@1",
    bindings: plan.execution_contract.chart_bindings,
    dataset: {
      table_id: table.table_id,
      columns: table.columns,
      rows: table.rows,
      total_rows: table.total_rows,
    },
  };
  const content = productTeamGovernedQueryInternals.materializeProductTeamArrow(
    document.projection,
    source.binding.columns,
  );
  const inputRef = {
    ...comparisonRef("SensitiveExecutionArtifact", 50),
    content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}` as const,
  };
  const outputs = [
    output("result", "RESULT", 60, result),
    output(`table:${table.table_id}`, "TABLE", 61, table),
    output(`chart:${chart.chart_id}`, "CHART", 62, chart),
  ];
  // Schema-valid unit fixture only. Not a real sandbox execution, materialization or production-isolation receipt.
  const receipt = analysisSandboxExecutionReceiptSchema.parse({
    schema_version: "analysis-sandbox-execution-receipt@1.0.0",
    workspace_id: comparisonId(2),
    run_id: comparisonId(3),
    attempt_id: comparisonId(90),
    worker_fence: 1,
    fence_token: "unit-fixture",
    idempotency_key: "unit-panel-oracle",
    request_hash: comparisonHash("1"),
    analysis_program_ref: comparisonRef("AnalysisProgram", 91),
    node_id: "panel",
    runtime_profile: "CORE_ANALYSIS",
    runtime: {
      provider: "OpenSandbox",
      opensandbox_sdk_version: "0.1.11",
      code_interpreter_sdk_version: "0.1.3",
      agent_image: "unit-agent",
      operator_image: "unit-operator",
      agent_sandbox_id: comparisonId(92),
      operator_sandbox_id: comparisonId(93),
    },
    generated_source_policy: "OPEN_ANALYSIS",
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    operator_obligations: [],
    operator_receipts: [],
    operator_receipt_closure_hash: comparisonHash("f"),
    result_contract_hash: contract.contract_hash,
    publish_manifest_hash: comparisonHash("a"),
    published_closure_hash: comparisonHash("b"),
    publish_id: "panel-unit",
    inputs: [
      {
        name: "query_evidence",
        format: "ARROW",
        query_evidence_ref: document.artifact_ref,
        input_ref: inputRef,
        materialization_receipt_ref: comparisonRef("AnalysisInputMaterializationReceipt", 51),
        content_sha256: inputRef.content_hash,
        bytes: content.byteLength,
      },
    ],
    cells: [
      {
        cell_id: "unit-cell",
        source_sha256: comparisonHash("c"),
        execution_id: null,
        execution_count: null,
        elapsed_ms: 0,
        status: "SUCCEEDED",
      },
    ],
    started_at: "2026-08-31T00:00:00Z",
    finished_at: "2026-08-31T00:00:00Z",
    elapsed_ms: 0,
    hard_controls: {
      network_isolated: true,
      scoped_filesystem: true,
      separate_operator_sandbox: true,
      resource_limits_enforced: true,
      secure_access: false,
    },
    status: "SUCCEEDED",
    failure_code: null,
    outputs: outputs.map(({ content: _content, ...rest }) => rest),
    execution_hash: comparisonHash("d"),
  });
  const input: OracleInput = {
    node: {
      node_id: "panel",
      skill_id: "open-python-analysis@1",
      method_registry_entry_ids: [MONTHLY_PANEL_METHOD_ID],
      metric_refs: source.context.metrics.map((metric) => metric.metric_ref),
      dimension_refs: plan.shape.dimension_ids,
      time_window: {
        start: "2024-01-01T00:00:00.000+08:00",
        end: "2025-01-01T00:00:00.000+08:00",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
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
        query_evidence_ref: document.artifact_ref,
        query_evidence_document: document,
        input_ref: inputRef,
        materialization_receipt_ref: comparisonRef("AnalysisInputMaterializationReceipt", 51),
        materialization_receipt_document: {},
        content,
      },
    ],
    sandbox_outputs: outputs,
    sandbox_receipt: receipt,
  };
  return { source, document, plan, result, table, chart, input };
}

describe("independent monthly panel oracle", () => {
  it.each(["valid", "parent", "child", "missing", "arrow"])(
    "verifies two-month rollup through full production closure: %s",
    async (kind) => {
      const base = await fixture();
      const source = await monthlyPanelFixture(true, true, false, 2);
      const plan = await compileMonthlyPanelPlan({
        context: source.context,
        query_evidence_ref: source.reference,
        query_evidence_document: source.document,
      });
      if (source.document.projection.kind !== "TABLE") throw new Error("TEST_TABLE_REQUIRED");
      // Plumbing fixture; arithmetic is separately tested with hand-calculated counterexamples.
      const data = monthlyPanelOracleInternals.expectedPanelData(plan).data;
      const rollup = data.ratio_rollup;
      if (!rollup?.axes[0]?.groups[0]) throw new Error("TEST_ROLLUP_REQUIRED");
      if (kind === "parent") rollup.axes[0].groups[0].to.ratio = 1;
      if (kind === "child") rollup.axes[0].groups[0].children.pop();
      if (kind === "missing") delete data.ratio_rollup;
      const contract = plan.result_contract;
      const result = {
        ...base.result,
        contract_hash: contract.contract_hash,
        metrics: contract.metric_bindings,
        dimensions: contract.dimension_bindings,
        grain: contract.grain,
        lineage: contract.lineage,
        data,
      };
      const table = {
        ...base.table,
        rows: data.observations,
        total_rows: data.observations.length,
      };
      const chart = {
        ...base.chart,
        dataset: {
          table_id: table.table_id,
          columns: table.columns,
          rows: table.rows,
          total_rows: table.total_rows,
        },
      };
      const projection = structuredClone(source.document.projection);
      if (kind === "arrow" && projection.rows[0]) projection.rows[0].spend = 999;
      const content = productTeamGovernedQueryInternals.materializeProductTeamArrow(
        projection,
        source.binding.columns,
      );
      const inputRef = {
        ...comparisonRef("SensitiveExecutionArtifact", 50),
        content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}` as const,
      };
      const outputs = [
        output("result", "RESULT", 60, result),
        output(`table:${table.table_id}`, "TABLE", 61, table),
        output(`chart:${chart.chart_id}`, "CHART", 62, chart),
      ];
      const prior = base.input.governed_inputs[0];
      if (!prior) throw new Error("TEST_INPUT_REQUIRED");
      const governed = {
        ...prior,
        query_evidence_ref: source.reference,
        query_evidence_document: source.document,
        content,
        input_ref: inputRef,
      };
      const input: OracleInput = {
        ...base.input,
        node: {
          ...base.input.node,
          result_contract: contract,
          time_window: resolveAnalysisEvidenceTimeWindow(source.binding, source.context),
        },
        governed_inputs: [governed],
        sandbox_outputs: outputs,
        sandbox_receipt: analysisSandboxExecutionReceiptSchema.parse({
          ...base.input.sandbox_receipt,
          result_contract_hash: contract.contract_hash,
          inputs: [
            {
              name: "query_evidence",
              format: "ARROW",
              query_evidence_ref: source.reference,
              input_ref: inputRef,
              materialization_receipt_ref: governed.materialization_receipt_ref,
              content_sha256: inputRef.content_hash,
              bytes: content.byteLength,
            },
          ],
          outputs: outputs.map(({ content: _content, ...rest }) => rest),
        }),
      };
      const verdict = productionGovernedAnalysisRuntimeInternals
        .oracleForMethods(source.context, [
          {
            method_id: MONTHLY_PANEL_METHOD_ID,
            skill_id: "open-python-analysis@1",
            result_contract: contract,
            required_operator_obligations: [],
            execution_contract: plan.execution_contract,
          },
        ])
        .evaluate(input);
      if (kind === "valid") {
        await expect(verdict).resolves.toMatchObject({
          sample_size: 8,
          oracle_receipt: { verdict: "PASS" },
        });
        expect(buildAnalysisNarrativeProjection(result).fields.ratio_rollup).toEqual(
          data.ratio_rollup,
        );
      } else await expect(verdict).rejects.toThrow();
    },
  );
  it("verifies complete overall YoY and category contributions through the production oracle and narrative projection", async () => {
    const test = await fixture(false, true, true);
    const method = {
      method_id: MONTHLY_PANEL_METHOD_ID,
      skill_id: "open-python-analysis@1" as const,
      result_contract: test.plan.result_contract,
      required_operator_obligations: [],
      execution_contract: test.plan.execution_contract,
    };
    const verdict = await productionGovernedAnalysisRuntimeInternals
      .oracleForMethods(test.source.context, [method])
      .evaluate(test.input);
    expect(verdict.oracle_receipt).toMatchObject({ verdict: "PASS" });
    expect(test.plan.result_contract.metric_bindings).toHaveLength(1);
    expect(buildAnalysisNarrativeProjection(test.result).fields.period_comparison).toEqual(
      test.result.data.period_comparison,
    );
    expect(test.result.data.period_comparison?.months[2]).toMatchObject({
      yoy_rate: null,
      ranking_eligible: false,
    });
    expect(test.result.data.period_comparison?.largest_declines).toHaveLength(1);
  });
  it.each(["total", "ranking", "contribution", "group", "omit", "basis"])(
    "rejects a rehashed YoY %s claim",
    async (kind) => {
      const test = await fixture(false, true, true);
      const comparison = test.result.data.period_comparison;
      const month = comparison?.months[0],
        decline = comparison?.largest_declines[0],
        group = decline?.groups[0];
      if (!comparison || !month || !decline || !group) throw new Error("TEST_COMPARISON_REQUIRED");
      if (kind === "total") month.current_value += 1;
      if (kind === "ranking") decline.period = period(2);
      if (kind === "contribution") group.contribution_to_total_growth = -0.25;
      if (kind === "group") decline.groups.pop();
      if (kind === "basis") comparison.ranking_basis = "GROUP_MOM";
      if (kind === "omit") delete test.result.data.period_comparison;
      test.input.sandbox_outputs = test.input.sandbox_outputs.map((original, i) =>
        i === 0
          ? output(original.artifact_name, original.artifact_kind, 60, test.result)
          : original,
      );
      test.input.sandbox_receipt = {
        ...test.input.sandbox_receipt,
        outputs: test.input.sandbox_outputs.map(({ content: _content, ...rest }) => rest),
      };
      await expect(
        createMonthlyPanelOracle(test.source.context).evaluate(test.input),
      ).rejects.toThrow("MONTHLY_PANEL_ORACLE_RESULT_MISMATCH");
    },
  );
  it("selects only the exact registered production oracle", async () => {
    const test = await fixture();
    const method = {
      method_id: MONTHLY_PANEL_METHOD_ID,
      skill_id: "open-python-analysis@1" as const,
      result_contract: test.plan.result_contract,
      required_operator_obligations: [],
      execution_contract: test.plan.execution_contract,
    };
    await expect(
      productionGovernedAnalysisRuntimeInternals
        .oracleForMethods(test.source.context, [method])
        .evaluate(test.input),
    ).resolves.toMatchObject({ implementation_id: "monthly-group-panel-oracle@2.0.0" });
    await expect(
      productionGovernedAnalysisRuntimeInternals
        .oracleForMethods(test.source.context, [])
        .evaluate(test.input),
    ).rejects.toThrow("PRODUCTION_ANALYSIS_METHOD_BINDING_INVALID");
    await expect(
      productionGovernedAnalysisRuntimeInternals
        .oracleForMethods(test.source.context, [method])
        .evaluate({ ...test.input, node: { ...test.input.node, skill_id: "trend-change@1" } }),
    ).rejects.toThrow("PRODUCTION_ANALYSIS_METHOD_BINDING_INVALID");
  });
  it.each(["zero", "negative", "missing", "overflow"])(
    "retains original %s endpoint semantics in opposed changes",
    async (variant) => {
      const test = await fixture(false);
      const plan = structuredClone(test.plan);
      const first = plan.shape.groups[0]?.rows[0];
      const last = plan.shape.groups[0]?.rows.at(-1);
      if (!first || !last) throw new Error("TEST_ENDPOINTS_REQUIRED");
      first.spend =
        variant === "zero"
          ? 0
          : variant === "negative"
            ? -10
            : variant === "overflow"
              ? -Number.MAX_VALUE
              : null;
      if (variant === "overflow") last.spend = Number.MAX_VALUE;
      const compute = () => monthlyPanelOracleInternals.expectedPanelData(plan);
      if (variant === "overflow") {
        expect(compute).toThrow("NUMERIC_RANGE_INVALID");
        return;
      }
      const pairs = compute().data.opposed_changes.pairs.filter(
        (pair) => pair.group.channel === "Email",
      );
      if (variant === "missing") expect(pairs).toEqual([]);
      else
        expect(pairs[0]).toMatchObject({
          increasing_column: "spend",
          increasing_absolute_change: variant === "negative" ? 30 : 20,
          increasing_relative_change: variant === "negative" ? -3 : null,
        });
    },
  );
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "checks all source groups and role-preserving table/chart: two=%s derived=%s",
    async (two, derived) => {
      const test = await fixture(two, derived);
      const verdict = await createMonthlyPanelOracle(test.source.context).evaluate(test.input);
      expect(verdict).toMatchObject({
        sample_size: two ? 48 : 24,
        coverage_ratio: 35 / 36,
        material_change: false,
        result: { oracle_scope: "FULL", declared_method: MONTHLY_PANEL_METHOD_ID },
        oracle_receipt: { verdict: "PASS", no_inferential_or_causal_claim: true },
      });
      const projections = await buildGovernedResultProjections({
        contract: test.plan.result_contract,
        governed_inputs: test.input.governed_inputs,
      });
      expect(projections[0]?.table_rows).toEqual(test.table.rows);
      expect(projections[0]?.result_rows).toEqual(test.result.data.observations);
      const chart = test.input.sandbox_outputs[2];
      if (!chart) throw new Error("TEST_CHART_REQUIRED");
      const staged = projectStagedAnalysisChart(chart);
      expect(staged.projection).toMatchObject({
        chart_type: "LINE",
        x_key: "month",
        series_key: "channel",
        ...(two ? { facet_key: "audience" } : {}),
        table: { rows: test.table.rows, total_rows: two ? 48 : 24 },
      });
      const narrative = buildAnalysisNarrativeProjection(test.result);
      expect(narrative.fields).toMatchObject({
        measure_1: test.result.data.measure_1,
        opposed_changes: test.result.data.opposed_changes,
      });
    },
  );

  it.each([
    "measure",
    "rank",
    "count",
    "group",
    "missing",
    "opposed-value",
    "opposed-omit",
    "opposed-order",
    "extra-fact",
    "causal",
    "observation",
    "table-row",
    "table-dimension",
    "chart-facet",
    "chart-series",
    "chart-row",
    "chart-version",
  ])("rejects rehashed %s corruption", async (kind) => {
    const test = await fixture();
    let changed: unknown = test.result;
    let index = 0;
    const first = test.result.data.measure_1.groups[0];
    const pair = test.result.data.opposed_changes.pairs[0];
    if (!first || !pair) throw new Error("TEST_MEASURE_REQUIRED");
    if (kind === "measure") first.absolute_change += 1;
    if (kind === "rank") first.lowest.reverse();
    if (kind === "count") first.observed_count -= 1;
    if (kind === "group") first.group.channel = "other";
    if (kind === "missing") {
      const rate = test.result.data.measure_3.groups[0];
      if (!rate) throw new Error("TEST_RATE_REQUIRED");
      rate.missing_count = 0;
    }
    if (kind === "opposed-value") pair.increasing_absolute_change += 1;
    if (kind === "opposed-omit") test.result.data.opposed_changes.pairs.pop();
    if (kind === "opposed-order") test.result.data.opposed_changes.pairs.reverse();
    if (kind === "extra-fact")
      changed = { ...test.result, data: { ...test.result.data, summary: "unverified assertion" } };
    if (kind === "causal") test.result.data.claim_strength = "CAUSAL";
    if (kind === "observation") test.result.data.observations.reverse();
    if (kind.startsWith("table")) {
      index = 1;
      changed =
        kind === "table-row"
          ? { ...test.table, rows: test.table.rows.slice(1) }
          : { ...test.table, columns: test.table.columns.slice(1) };
    }
    if (kind.startsWith("chart")) {
      index = 2;
      changed =
        kind === "chart-facet"
          ? { ...test.chart, bindings: { ...test.chart.bindings, facet_field: "channel" } }
          : kind === "chart-series"
            ? { ...test.chart, bindings: { ...test.chart.bindings, series_field: null } }
            : kind === "chart-row"
              ? {
                  ...test.chart,
                  dataset: { ...test.chart.dataset, rows: test.chart.dataset.rows.slice(1) },
                }
              : { ...test.chart, schema_version: "analysis-published-chart@1.0.0" };
    }
    test.input.sandbox_outputs = test.input.sandbox_outputs.map((original, i) =>
      i === index
        ? output(original.artifact_name, original.artifact_kind, 60 + i, changed)
        : original,
    );
    await expect(
      createMonthlyPanelOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow(/MONTHLY_PANEL_ORACLE_.*MISMATCH/);
  });

  it.each([
    "bytes",
    "hash",
    "run",
    "duplicate-output",
    "missing-output",
    "method",
    "dimension",
    "window",
    "receipt-contract",
    "extra-input",
    "arrow",
  ])("rejects %s closure drift before accepting results", async (kind) => {
    const test = await fixture();
    const original = test.input.sandbox_outputs[0];
    if (!original) throw new Error("TEST_OUTPUT_REQUIRED");
    if (kind === "bytes")
      test.input.sandbox_outputs = [
        { ...original, bytes: original.bytes + 1 },
        ...test.input.sandbox_outputs.slice(1),
      ];
    if (kind === "hash")
      test.input.sandbox_outputs = [
        { ...original, content_sha256: comparisonHash("e") },
        ...test.input.sandbox_outputs.slice(1),
      ];
    if (kind === "run")
      test.input.sandbox_outputs = [
        { ...original, reference: { ...original.reference, run_id: comparisonId(999) } },
        ...test.input.sandbox_outputs.slice(1),
      ];
    if (kind === "duplicate-output")
      test.input.sandbox_outputs = [original, original, ...test.input.sandbox_outputs.slice(1)];
    if (kind === "missing-output") test.input.sandbox_outputs = test.input.sandbox_outputs.slice(1);
    if (kind === "method")
      test.input.node = { ...test.input.node, method_registry_entry_ids: ["other@1"] };
    if (kind === "dimension")
      test.input.node = { ...test.input.node, dimension_refs: ["dimension.month"] };
    if (kind === "window") test.input.node = { ...test.input.node, time_window: null };
    if (kind === "receipt-contract")
      test.input.sandbox_receipt = {
        ...test.input.sandbox_receipt,
        result_contract_hash: comparisonHash("e"),
      };
    if (kind === "extra-input")
      test.input.governed_inputs = [...test.input.governed_inputs, ...test.input.governed_inputs];
    if (kind === "arrow") {
      const governed = test.input.governed_inputs[0];
      if (!governed || test.document.projection.kind !== "TABLE")
        throw new Error("TEST_INPUT_REQUIRED");
      const projection = {
        ...test.document.projection,
        rows: test.document.projection.rows.map((row, index) =>
          index === 0 ? { ...row, spend: 999 } : row,
        ),
      };
      test.input.governed_inputs = [
        {
          ...governed,
          content: productTeamGovernedQueryInternals.materializeProductTeamArrow(
            projection,
            test.source.binding.columns,
          ),
        },
      ];
    }
    await expect(
      createMonthlyPanelOracle(test.source.context).evaluate(test.input),
    ).rejects.toThrow(/MONTHLY_PANEL_ORACLE_|ANALYSIS_INPUT_/);
  });
});
