import { createHash } from "node:crypto";
import {
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts/statistical-operators";
import { describe, expect, it } from "vitest";
import { buildGovernedResultProjections } from "../../src/analysis/governed-result-projection.js";
import { productTeamGovernedQueryInternals } from "../../src/analysis/product-team-query-port.js";
import { createSingleSeriesAnalysisOracle } from "../../src/analysis/single-series-analysis-oracle.js";
import { compileSingleSeriesAnalysisPlan } from "../../src/analysis/single-series-analysis-planning.js";
import { buildTestQueryEvidenceSemanticBinding } from "./support/query-evidence-semantic-binding.js";

const id = (suffix: number) => `62000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  suffix: number,
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  };
}

function month(index: number): string {
  return new Date(Date.UTC(2025, 7 + index, 1)).toISOString().slice(0, 10);
}

async function analysisContext(input?: { readonly metricGranularity?: "atomic" | "month" }) {
  const semanticReleaseRef = reference("SemanticRelease", 10);
  return buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope,
    semantic_context_binding: {
      package_id: id(20),
      package_hash: hash("a"),
      receipt_id: id(21),
      receipt_hash: hash("b"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: reference("SchemaSnapshot", 11),
    policy_receipt_ref: reference("PolicyReceipt", 12),
    semantic_retrieval_receipt_hash: hash("c"),
    semantic_inference_receipt_hash: hash("d"),
    metrics: [
      {
        metric_ref: { container_ref: semanticReleaseRef, node_id: "metric.order_revenue" },
        formula_hash: hash("e"),
        unit: {
          unit_id: "unit.cny",
          dimension: "currency",
          base_unit: "CNY",
          conversion_factor: 1,
        },
        grain: {
          grain_id: input?.metricGranularity === "atomic" ? "grain.order" : "grain.order-month",
          granularity: input?.metricGranularity ?? "month",
        },
        time_domain: {
          time_domain_id: "time.complete-month",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: null,
          max_time: null,
        },
        time_dimension_ref: "dimension.order_month",
        additivity: "additive",
        null_policy: "exclude",
        missing_period_policy: "REJECT_GAP",
        seasonality: null,
        priority: 10_000,
        causal_role: "OUTCOME",
        allowed_dimensions: [
          {
            dimension_id: "dimension.order_month",
            grain: { grain_id: "grain.order-month", granularity: "month" },
            data_type: "date",
            sensitivity: "INTERNAL",
            groupable: true,
            pivotable: true,
            causal_role: null,
          },
        ],
        analysis_capabilities: ["CHART_DATASET", "TREND_CHANGE"],
      },
    ],
    relationships: [],
    causal_policy: null,
  });
}

async function queryEvidence(input?: {
  readonly monthIndexes?: readonly number[];
  readonly extraNumericColumn?: boolean;
  readonly timeLogicalType?: "DATE" | "DATETIME";
  readonly timeGranularity?: "atomic" | "month";
  readonly timezone?: string;
}): Promise<ProductTeamArtifactDocument> {
  const sql = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: reference("SqlArtifact", 30),
    profile_id: "governed-text2sql-agent",
    task_id: id(31),
    source_refs: [],
    provenance: {
      kind: "TEXT2SQL_CANDIDATE",
      candidate_hash: hash("1"),
      parameters_hash: hash("2"),
      parameter_count: 0,
      datasource_ref: { resource_id: id(32), resource_revision: 1, resource_hash: hash("3") },
      schema_snapshot_ref: { resource_id: id(33), resource_hash: hash("4") },
      semantic_context_ref: { package_id: id(20), package_hash: hash("a") },
      semantic_query_context_ref: null,
      semantic_query_context_hash: null,
      target_binding_hash: hash("5"),
    },
    projection: { kind: "SQL", dialect: "postgresql", sql: "select period, metric_value" },
    committed_at: "2026-08-26T00:00:00.000Z",
  });
  const indexes = input?.monthIndexes ?? Array.from({ length: 12 }, (_, index) => index);
  const timeLogicalType = input?.timeLogicalType ?? "DATE";
  const rows = indexes.map((index) => ({
    period:
      timeLogicalType === "DATETIME"
        ? new Date(Date.UTC(2025, 7 + index, 1) - 8 * 60 * 60 * 1_000).toISOString()
        : month(index),
    metric_value: 100 + index * 10,
    ...(input?.extraNumericColumn ? { order_count: 10 + index } : {}),
  }));
  const semanticBinding = await buildTestQueryEvidenceSemanticBinding({
    columns: [
      {
        name: "period",
        logical_type: timeLogicalType,
        nullable: false,
        semantic_role: "DIMENSION",
        semantic_object_id: "dimension.order_month",
        grain: {
          grain_id: "grain.order-month",
          granularity: input?.timeGranularity ?? "month",
        },
      },
      {
        name: "metric_value",
        logical_type: "NUMBER",
        nullable: false,
        semantic_role: "METRIC",
        semantic_object_id: "metric.order_revenue",
        grain: { grain_id: "grain.order", granularity: "atomic" },
      },
      ...(input?.extraNumericColumn
        ? [
            {
              name: "order_count",
              logical_type: "NUMBER" as const,
              nullable: false,
              semantic_role: "METRIC" as const,
              semantic_object_id: "metric.order_count",
              grain: { grain_id: "grain.order", granularity: "atomic" as const },
            },
          ]
        : []),
    ],
    time_window: {
      dimension_id: "dimension.order_month",
      start: "2025-08-01T00:00:00.000Z",
      end: "2026-08-01T00:00:00.000Z",
      semantics: "HALF_OPEN",
      timezone: input?.timezone ?? "Asia/Shanghai",
    },
  });
  return buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: reference("QueryEvidence", 34),
    profile_id: "governed-text2sql-agent",
    task_id: id(31),
    source_refs: [sql.artifact_ref],
    provenance: {
      kind: "GOVERNED_QUERY_RESULT",
      query_id: id(35),
      request_hash: hash("6"),
      result_hash: hash("7"),
      row_count: rows.length,
      byte_count: 1_024,
      elapsed_ms: 12,
      truncated: false,
      semantic_binding: semanticBinding,
    },
    projection: {
      kind: "TABLE",
      columns: [
        { key: "period", label: "月份", data_type: "STRING" },
        { key: "metric_value", label: "订单收入", data_type: "NUMBER" },
        ...(input?.extraNumericColumn
          ? [{ key: "order_count", label: "订单量", data_type: "NUMBER" as const }]
          : []),
      ],
      rows,
      total_rows: rows.length,
    },
    committed_at: "2026-08-26T00:00:01.000Z",
  });
}

async function planInput(document: ProductTeamArtifactDocument) {
  if (document.artifact_ref.artifact_type !== "QueryEvidence") {
    throw new TypeError("TEST_QUERY_EVIDENCE_REQUIRED");
  }
  return {
    question:
      "最近12个完整月的订单收入有没有持续上升或下降趋势？请说明趋势强度，并提供一张月度折线图。",
    question_frame_ref: reference("QuestionFrame", 40) as ArtifactReference & {
      artifact_type: "QuestionFrame";
    },
    context: await analysisContext(),
    query_evidence_ref: document.artifact_ref,
    query_evidence_document: document,
  };
}

describe("generic single-series analysis planning", () => {
  it("compiles exact semantic, operator, result and chart obligations without a case id", async () => {
    const evidence = await queryEvidence();
    const plan = await compileSingleSeriesAnalysisPlan(await planInput(evidence));

    expect(plan.brief.requested_time_window).toEqual({
      start: "2025-08-01T00:00:00.000Z",
      end: "2026-08-01T00:00:00.000Z",
      timezone: "Asia/Shanghai",
      semantics: "HALF_OPEN",
    });
    expect(plan.required_operator_obligations.map(({ operator_id }) => operator_id)).toEqual([
      "robust-trend.theil-sen-slope@1",
      "trend.mann-kendall-original@1",
    ]);
    expect(plan.result_contract).toMatchObject({
      metric_bindings: [{ semantic_metric_id: "metric.order_revenue", field: "series" }],
      dimension_bindings: [{ semantic_dimension_id: "dimension.order_month", field: "series" }],
      charts: [
        {
          chart_id: "single_series_monthly_line",
          intent: "TREND",
          allowed_template_ids: ["line.multi-series@1"],
        },
      ],
    });
    expect(JSON.stringify(plan)).not.toContain("case_id");
  });

  it("projects direct result collections from verified QueryEvidence with canonical months", async () => {
    const evidence = await queryEvidence({ timeLogicalType: "DATETIME" });
    const plan = await compileSingleSeriesAnalysisPlan(await planInput(evidence));
    if (
      evidence.artifact_ref.artifact_type !== "QueryEvidence" ||
      evidence.projection.kind !== "TABLE" ||
      evidence.provenance?.kind !== "GOVERNED_QUERY_RESULT"
    ) {
      throw new TypeError("TEST_QUERY_EVIDENCE_REQUIRED");
    }
    const content = productTeamGovernedQueryInternals.materializeProductTeamArrow(
      evidence.projection,
      evidence.provenance.semantic_binding.columns,
    );

    const governedInput = {
      name: "query_evidence",
      format: "ARROW" as const,
      query_evidence_ref: evidence.artifact_ref,
      query_evidence_document: evidence,
      input_ref: reference("SensitiveExecutionArtifact", 80),
      materialization_receipt_ref: reference("AnalysisInputMaterializationReceipt", 81),
      materialization_receipt_document: {},
      content,
    };
    const projections = await buildGovernedResultProjections({
      contract: plan.result_contract,
      governed_inputs: [governedInput],
    });

    expect(projections).toEqual([
      {
        table_id: "single_series_monthly",
        collection_field: "series",
        result_rows: Array.from({ length: 12 }, (_, index) => ({
          period: month(index),
          value: 100 + index * 10,
        })),
        table_rows: Array.from({ length: 12 }, (_, index) => ({
          period: month(index),
          value: 100 + index * 10,
        })),
      },
    ]);
    await expect(
      buildGovernedResultProjections({
        contract: plan.result_contract,
        governed_inputs: [governedInput, { ...governedInput, name: "duplicate_evidence" }],
      }),
    ).rejects.toThrowError("ANALYSIS_GOVERNED_RESULT_PROJECTION_INVALID");
  });

  it("uses governed monthly evidence for an atomic published metric and DATETIME values", async () => {
    const evidence = await queryEvidence({ timeLogicalType: "DATETIME" });
    const input = await planInput(evidence);
    const plan = await compileSingleSeriesAnalysisPlan({
      ...input,
      context: await analysisContext({ metricGranularity: "atomic" }),
    });

    expect(plan.query_shape.ordered_months).toEqual(
      Array.from({ length: 12 }, (_, index) => month(index)),
    );
    expect(plan.brief.requested_time_window).toEqual({
      start: "2025-08-01T00:00:00.000Z",
      end: "2026-08-01T00:00:00.000Z",
      timezone: "Asia/Shanghai",
      semantics: "HALF_OPEN",
    });
  });

  it("rejects evidence without governed month grain", async () => {
    const evidence = await queryEvidence({ timeGranularity: "atomic" });
    await expect(compileSingleSeriesAnalysisPlan(await planInput(evidence))).rejects.toThrowError(
      "SINGLE_SERIES_QUERY_SHAPE_INVALID",
    );
  });

  it("rejects evidence whose timezone differs from the published metric authority", async () => {
    const evidence = await queryEvidence({ timezone: "UTC" });
    await expect(compileSingleSeriesAnalysisPlan(await planInput(evidence))).rejects.toThrowError(
      "SINGLE_SERIES_QUERY_AUTHORITY_INVALID",
    );
  });

  it("rejects a gapped 12-row month series", async () => {
    const evidence = await queryEvidence({
      monthIndexes: [...Array.from({ length: 11 }, (_, index) => index), 12],
    });
    await expect(compileSingleSeriesAnalysisPlan(await planInput(evidence))).rejects.toThrowError(
      "SINGLE_SERIES_COMPLETE_MONTH_WINDOW_INVALID",
    );
  });

  it("rejects an ambiguous multi-metric query shape", async () => {
    const evidence = await queryEvidence({ extraNumericColumn: true });
    await expect(compileSingleSeriesAnalysisPlan(await planInput(evidence))).rejects.toThrowError(
      "SINGLE_SERIES_QUERY_SHAPE_INVALID",
    );
  });
});

function outputReference(suffix: number, contentHash: `sha256:${string}`): ArtifactReference {
  return { ...reference("SandboxResult", suffix), content_hash: contentHash };
}

function boundOutput(
  artifact_name: string,
  artifact_kind: "RESULT" | "TABLE" | "CHART",
  suffix: number,
  document: unknown,
) {
  const content = new TextEncoder().encode(JSON.stringify(document));
  const content_sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
  return {
    artifact_name,
    artifact_kind,
    media_type: "application/json" as const,
    content,
    content_sha256,
    bytes: content.byteLength,
    reference: outputReference(suffix, content_sha256),
  };
}

async function oracleFixture() {
  const evidence = await queryEvidence();
  const plan = await compileSingleSeriesAnalysisPlan(await planInput(evidence));
  if (evidence.projection.kind !== "TABLE") throw new TypeError("TEST_TABLE_REQUIRED");
  const rows = Array.from({ length: 12 }, (_, index) => ({
    period: month(index),
    value: 100 + index * 10,
  }));
  const theil_sen = {
    series: [{ label: "metric_value", slope: 10, sample_size: 12, pair_count: 66 }],
  };
  const mann_kendall = {
    series: [
      {
        label: "metric_value",
        s: 66,
        variance_s: 212.66666666666666,
        z: 4.457,
        p_value: 0.0000083,
        tau: 1,
        trend: "INCREASING",
        rejected: true,
        sample_size: 12,
        tie_group_count: 0,
        alpha: 0.05,
        variant: "original",
      },
    ],
  };
  const data = { series: rows, theil_sen, mann_kendall, summary_zh: "订单收入呈上升趋势。" };
  const result = {
    schema_version: "analysis-published-result@1.0.0",
    contract_id: plan.result_contract.contract_id,
    contract_hash: plan.result_contract.contract_hash,
    semantic_context_hash: plan.result_contract.semantic_context_hash,
    metrics: plan.result_contract.metric_bindings,
    dimensions: plan.result_contract.dimension_bindings,
    grain: plan.result_contract.grain,
    lineage: plan.result_contract.lineage,
    data,
  };
  const table = {
    schema_version: "analysis-published-table@1.0.0",
    table_id: "single_series_monthly",
    title_zh: plan.result_contract.tables[0]?.title_zh,
    columns: plan.result_contract.tables[0]?.columns,
    rows,
    total_rows: 12,
  };
  const chart = {
    schema_version: "analysis-published-chart@1.0.0",
    chart_id: "single_series_monthly_line",
    title_zh: plan.result_contract.charts[0]?.title_zh,
    intent: "TREND",
    template_id: "line.multi-series@1",
    bindings: {
      x_field: "period",
      y_fields: ["value"],
      series_field: null,
      lower_bound_field: null,
      upper_bound_field: null,
    },
    dataset: {
      table_id: "single_series_monthly",
      columns: plan.result_contract.tables[0]?.columns,
      rows,
      total_rows: 12,
    },
  };
  const queryRef = evidence.artifact_ref;
  if (queryRef.artifact_type !== "QueryEvidence") throw new TypeError("TEST_QUERY_REQUIRED");
  const governed = {
    name: "query_evidence",
    format: "ARROW" as const,
    query_evidence_ref: queryRef,
    query_evidence_document: evidence,
    input_ref: reference("SensitiveExecutionArtifact", 50),
    materialization_receipt_ref: reference("AnalysisInputMaterializationReceipt", 51),
    materialization_receipt_document: {},
    content: productTeamGovernedQueryInternals.materializeProductTeamArrow(
      evidence.projection,
      evidence.provenance?.kind === "GOVERNED_QUERY_RESULT"
        ? evidence.provenance.semantic_binding.columns
        : [],
    ),
  };
  const operatorReceipts = [
    {
      schema_version: "statistical-operator-call-receipt@1.0.0",
      call_id: "single_series_theil_sen",
      operator_id: "robust-trend.theil-sen-slope@1",
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      implementation_digest: hash("1"),
      resolved_parameters: {},
      resolved_parameters_hash: hash("2"),
      input_hash: hash("3"),
      output_hash: hash("4"),
      result_binding_hash: hash("5"),
      sample_size: 12,
      group_count: 1,
      family_size: null,
      rank: null,
      applicability: "PASS",
      limitation_codes: ["SLOPE_UNIT_DEPENDS_ON_DECLARED_X_SCALE"],
    },
    {
      schema_version: "statistical-operator-call-receipt@1.0.0",
      call_id: "single_series_mann_kendall",
      operator_id: "trend.mann-kendall-original@1",
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      implementation_digest: hash("6"),
      resolved_parameters: { alpha: 0.05, continuity_correction: true, variant: "original" },
      resolved_parameters_hash: hash("7"),
      input_hash: hash("8"),
      output_hash: hash("9"),
      result_binding_hash: hash("0"),
      sample_size: 12,
      group_count: 1,
      family_size: null,
      rank: null,
      applicability: "ASSUMPTION_BOUND",
      limitation_codes: ["SEASONALITY_NOT_CORRECTED", "SERIAL_CORRELATION_NOT_CORRECTED"],
    },
  ];
  return {
    data,
    input: {
      node: {
        node_id: "single-series-trend",
        result_contract: plan.result_contract,
      } as never,
      governed_inputs: [governed],
      sandbox_outputs: [
        boundOutput("result", "RESULT", 60, result),
        boundOutput("table:single_series_monthly", "TABLE", 61, table),
        boundOutput("chart:single_series_monthly_line", "CHART", 62, chart),
      ],
      sandbox_receipt: {
        result_contract_hash: plan.result_contract.contract_hash,
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        operator_obligations: plan.required_operator_obligations,
        operator_receipts: operatorReceipts,
        operator_receipt_closure_hash: hash("f"),
      } as never,
    },
  };
}

describe("generic single-series analysis Oracle", () => {
  it("accepts only the exact 12-month QueryEvidence, governed operators and chart closure", async () => {
    const fixture = await oracleFixture();
    const verdict = await createSingleSeriesAnalysisOracle().evaluate(fixture.input);

    expect(verdict).toMatchObject({
      result: {
        result_kind: "TREND_CHANGE",
        first_value: 100,
        last_value: 210,
      },
      sample_size: 12,
      coverage_ratio: 1,
      material_change: true,
      oracle_receipt: {
        schema_version: "single-series-trend-oracle@1.0.0",
        verdict: "PASS",
        trend_evidence: { slope: 10, tau: 1, rejected: true, trend: "INCREASING" },
      },
    });
  });

  it("fails closed when the model-published series differs from QueryEvidence", async () => {
    const fixture = await oracleFixture();
    const changed = {
      ...fixture.data,
      series: fixture.data.series.map((row, index) =>
        index === 11 ? { ...row, value: row.value + 1 } : row,
      ),
    };
    const resultDocument = JSON.parse(
      new TextDecoder().decode(fixture.input.sandbox_outputs[0]?.content),
    );
    const changedOutput = boundOutput("result", "RESULT", 63, {
      ...resultDocument,
      data: changed,
    });
    await expect(
      createSingleSeriesAnalysisOracle().evaluate({
        ...fixture.input,
        sandbox_outputs: [changedOutput, ...fixture.input.sandbox_outputs.slice(1)],
      }),
    ).rejects.toThrowError("SINGLE_SERIES_ORACLE_SERIES_MISMATCH");
  });
});
