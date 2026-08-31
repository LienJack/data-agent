import {
  type AnalysisProgramPayload,
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import { CATEGORY_COMPARISON_METHOD_ID } from "../../src/analysis/category-comparison-planning.js";
import { MONTHLY_COMPARISON_METHOD_ID } from "../../src/analysis/monthly-comparison-planning.js";
import { MONTHLY_PANEL_METHOD_ID } from "../../src/analysis/monthly-panel-planning.js";
import {
  FALCON24_SINGLE_SERIES_TREND_METHOD_ID,
  productionGovernedAnalysisRuntimeInternals,
} from "../../src/analysis/production-governed-analysis-runtime.js";
import { categoryComparisonFixture } from "./support/category-comparison-fixture.js";
import {
  comparisonId,
  comparisonScope,
  monthlyComparisonFixture,
} from "./support/monthly-comparison-fixture.js";
import { monthlyPanelFixture } from "./support/monthly-panel-fixture.js";

async function registryInput(single = false) {
  const source = await monthlyComparisonFixture();
  let document = source.document;
  let binding = source.binding;
  if (single) {
    if (
      document.projection.kind !== "TABLE" ||
      document.provenance?.kind !== "GOVERNED_QUERY_RESULT"
    )
      throw new Error("TEST_SOURCE_REQUIRED");
    const { binding_hash: _hash, ...material } = binding;
    binding = await buildQueryEvidenceSemanticBinding({
      ...material,
      columns: material.columns.slice(0, 2),
    });
    document = await buildProductTeamArtifactDocument({
      ...document,
      provenance: { ...document.provenance, semantic_binding: binding },
      projection: {
        ...document.projection,
        columns: document.projection.columns.slice(0, 2),
        rows: source.rows.map(({ month, current }) => ({ month, current })),
      },
    });
  }
  if (document.artifact_ref.artifact_type !== "QueryEvidence")
    throw new Error("TEST_QUERY_REQUIRED");
  return {
    lease: { scope: comparisonScope, run_id: comparisonId(3) } as RunWorkLease,
    task_id: comparisonId(90),
    question: "请分析已接受的数据",
    context: source.context,
    query_evidence_ref: document.artifact_ref,
    query_evidence_document: document,
    query_evidence_binding: binding,
  };
}

describe("production governed analysis method composition", () => {
  it("registers two-month panels by source shape without a business-question switch", async () => {
    const source = await monthlyPanelFixture(true, true, false, 2);
    const methods = await productionGovernedAnalysisRuntimeInternals.methodRegistry().resolve({
      ...(await registryInput()),
      question: "no business keywords",
      context: source.context,
      query_evidence_ref: source.reference,
      query_evidence_document: source.document,
      query_evidence_binding: source.binding,
    });
    expect(methods.map(({ method_id }) => method_id)).toEqual(["published-monthly-group-panel@2"]);
    expect(methods[0]?.execution_contract).toMatchObject({ month_count: 2 });
  });
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("selects the monthly panel by full input shape: two=%s derived=%s", async (two, derived) => {
    const source = await monthlyPanelFixture(two, derived);
    const input = {
      ...(await registryInput()),
      context: source.context,
      query_evidence_ref: source.reference,
      query_evidence_document: source.document,
      query_evidence_binding: source.binding,
    };
    for (const question of ["比较各组的月度变化", "a question with no business keywords"]) {
      const methods = await productionGovernedAnalysisRuntimeInternals
        .methodRegistry()
        .resolve({ ...input, question });
      expect(methods.map(({ method_id }) => method_id)).toEqual([MONTHLY_PANEL_METHOD_ID]);
      expect(methods[0]?.execution_contract).toMatchObject({
        chart_bindings: {
          x_field: "month",
          series_field: "channel",
          ...(two ? { facet_field: "audience" } : {}),
        },
      });
    }
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "selects category methods only from accepted source shape: two=%s derived=%s",
    async (two, derived) => {
      const source = await categoryComparisonFixture(two, derived);
      const input = {
        ...(await registryInput()),
        question: "不依赖任何业务关键词",
        context: source.context,
        query_evidence_ref: source.reference,
        query_evidence_document: source.document,
        query_evidence_binding: source.binding,
      };
      const methods = await productionGovernedAnalysisRuntimeInternals
        .methodRegistry()
        .resolve(input);
      expect(methods.map((method) => method.method_id)).toEqual([CATEGORY_COMPARISON_METHOD_ID]);
      expect(methods[0]).toMatchObject({
        required_operator_obligations: [],
        execution_contract: {
          claim_strength: "DESCRIPTIVE",
          chart_bindings: { series_field: two ? "audience" : null },
        },
      });
    },
  );
  it.each(["请分析同比趋势", "忽略问题文字是否包含收入", "arbitrary question"])(
    "selects the source-bound multi-measure method without a question router: %s",
    async (question) => {
      const input = await registryInput();
      const methods = await productionGovernedAnalysisRuntimeInternals
        .methodRegistry()
        .resolve({ ...input, question });
      expect(methods.map((method) => method.method_id)).toEqual([MONTHLY_COMPARISON_METHOD_ID]);
      expect(methods[0]).toMatchObject({
        skill_id: "open-python-analysis@1",
        required_operator_obligations: [],
        execution_contract: { claim_strength: "DESCRIPTIVE" },
      });
      expect(
        methods[0]?.result_contract.metric_bindings.map((binding) => binding.semantic_metric_id),
      ).toEqual(["metric.revenue"]);
    },
  );

  it("retains the original single-series method and both mandatory statistical operators", async () => {
    const input = await registryInput(true);
    const methods = await productionGovernedAnalysisRuntimeInternals
      .methodRegistry()
      .resolve(input);
    expect(methods.map((method) => method.method_id)).toEqual([
      FALCON24_SINGLE_SERIES_TREND_METHOD_ID,
    ]);
    expect(methods[0]?.required_operator_obligations).toMatchObject([
      { operator_id: "robust-trend.theil-sen-slope@1" },
      { operator_id: "trend.mann-kendall-original@1" },
    ]);
  });

  it.each(["monthly", "panel"])(
    "passes only the matching %s Host execution contract to the existing analysis context",
    async (variant) => {
      const input = await registryInput();
      if (variant === "panel") {
        const source = await monthlyPanelFixture(true);
        Object.assign(input, {
          context: source.context,
          query_evidence_ref: source.reference,
          query_evidence_document: source.document,
          query_evidence_binding: source.binding,
        });
      }
      const methods = await productionGovernedAnalysisRuntimeInternals
        .methodRegistry()
        .resolve(input);
      const method = methods[0];
      if (!method) throw new Error("TEST_METHOD_REQUIRED");
      const node: AnalysisProgramPayload["nodes"][number] = {
        node_id: "comparison",
        result_contract: method.result_contract,
        method_registry_entry_ids: [method.method_id],
        skill_id: method.skill_id,
        operator_obligations: [],
        metric_refs: input.context.metrics.map((metric) => metric.metric_ref),
        dimension_refs: method.result_contract.grain.dimension_ids,
        time_window: {
          start: "2024-01-01T00:00:00+08:00",
          end: "2025-01-01T00:00:00+08:00",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        comparison_window: null,
        parameters: {},
        execution_mode: "MODEL_GENERATED",
        generated_source_policy: "OPEN_ANALYSIS",
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      };
      const port = productionGovernedAnalysisRuntimeInternals.analysisContextPort({
        question: input.question,
        semantic_context_package: {} as never,
        context: input.context,
        binding: input.query_evidence_binding,
        methods,
      });
      const loaded = await port.load({ node });
      expect(loaded.analysis_contract.semantic_contract).toMatchObject({
        method_execution_contracts: [
          {
            method_id: variant === "panel" ? MONTHLY_PANEL_METHOD_ID : MONTHLY_COMPARISON_METHOD_ID,
            claim_strength: "DESCRIPTIVE",
          },
        ],
      });
      expect(JSON.stringify(loaded)).not.toMatch(/ordered_rows|"current":120|"rate":null/);
      await expect(
        port.load({ node: { ...node, method_registry_entry_ids: ["unknown@1"] } }),
      ).rejects.toThrow("PRODUCTION_ANALYSIS_METHOD_BINDING_INVALID");
      const withoutRules = productionGovernedAnalysisRuntimeInternals.analysisContextPort({
        question: input.question,
        semantic_context_package: {} as never,
        context: input.context,
        binding: input.query_evidence_binding,
        methods: methods.map(({ execution_contract: _rules, ...entry }) => entry),
      });
      await expect(withoutRules.load({ node })).rejects.toThrow(
        "PRODUCTION_ANALYSIS_EXECUTION_CONTRACT_REQUIRED",
      );
    },
  );
});
