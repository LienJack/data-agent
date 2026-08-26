import {
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { describe, expect, it } from "vitest";
import { compileSingleSeriesAnalysisPlan } from "../../src/analysis/single-series-analysis-planning.js";

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

async function analysisContext() {
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
        grain: { grain_id: "grain.order-month", granularity: "month" },
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
      target_binding_hash: hash("5"),
    },
    projection: { kind: "SQL", dialect: "postgresql", sql: "select period, metric_value" },
    committed_at: "2026-08-26T00:00:00.000Z",
  });
  const indexes = input?.monthIndexes ?? Array.from({ length: 12 }, (_, index) => index);
  const rows = indexes.map((index) => ({
    period: month(index),
    metric_value: 100 + index * 10,
    ...(input?.extraNumericColumn ? { order_count: 10 + index } : {}),
  }));
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
